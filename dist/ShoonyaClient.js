import axios from 'axios';
import { sha256 } from 'js-sha256';
import { TOTP } from 'totp-generator';
import { MasterData } from './MasterData.js';
const BASE_URL = 'https://api.shoonya.com/NorenWClientAPI/';
export class ShoonyaClient {
    loggedIn = false;
    susertoken = null;
    username = null;
    accountid = null;
    masterData = new MasterData();
    async makeRequest(endpoint, values, requiresAuth = true) {
        try {
            let payload = 'jData=' + JSON.stringify(values);
            if (requiresAuth) {
                if (!this.susertoken)
                    throw new Error("Not logged in");
                payload += '&jKey=' + this.susertoken;
            }
            const res = await axios.post(`${BASE_URL}${endpoint}`, payload, {
                validateStatus: () => true // Resolve all status codes to parse JSON errors
            });
            return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        }
        catch (error) {
            throw new Error(`API Request Failed: ${error.message}`);
        }
    }
    _appendMargin = async (response) => {
        if (response.status === "success" && this.loggedIn) {
            const marginRes = await this.getMargin();
            if (marginRes.status === "success") {
                response.available_margin = marginRes.available_margin;
            }
        }
        return response;
    };
    async login(user_id, password, totp_key, vendor_code, api_key, imei) {
        try {
            const { otp } = await TOTP.generate(totp_key);
            const pwdHash = sha256(password);
            const appKeyHash = sha256(`${user_id}|${api_key}`);
            const values = {
                source: "API",
                apkversion: "1.0.0",
                uid: user_id,
                pwd: pwdHash,
                factor2: otp,
                vc: vendor_code,
                appkey: appKeyHash,
                imei: imei
            };
            const resDict = await this.makeRequest('QuickAuth', values, false);
            if (resDict.stat === 'Ok') {
                this.loggedIn = true;
                this.username = user_id;
                this.accountid = user_id;
                this.susertoken = resDict.susertoken;
                // Background master data download
                this.masterData.downloadMasterData().catch((e) => console.error("Background MD fail:", e));
                return { status: "success", message: "Successfully logged in to Shoonya, master data downloading..." };
            }
            else {
                return { status: "error", message: resDict.emsg || "Login failed" };
            }
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    /**
     * Login using credentials from the encrypted SecureVault.
     * The AI never sees any credential values.
     */
    async loginFromVault(credentials) {
        return this.login(credentials.user_id, credentials.password, credentials.totp_key, credentials.vendor_code, credentials.api_key, credentials.imei);
    }
    _parseOrderCommand(command) {
        const parts = command.trim().toUpperCase().split(/\s+/);
        if (parts.length < 4) {
            throw new Error("Invalid command format. Expected: INDEX STRIKE CE/PE QTY [L/SL PRICE]");
        }
        const index = parts[0];
        const strike = parseFloat(parts[1]);
        const option_type = parts[2];
        const qty = parseInt(parts[3], 10);
        let price_type = "MKT";
        let price = 0.0;
        let trigger_price = 0.0;
        if (parts.length >= 6) {
            const modifier = parts[4];
            if (modifier === "L") {
                price_type = "LMT";
                price = parseFloat(parts[5]);
            }
            else if (modifier === "SL") {
                price_type = "SL-LMT";
                price = parseFloat(parts[5]);
                let rawTrigger = price + 0.05;
                trigger_price = Math.round(rawTrigger * 20) / 20.0;
            }
        }
        return { index, strike, option_type, quantity: qty, price_type, price, trigger_price };
    }
    async placeOrder(buy_or_sell, command, exchange = 'NFO', product_type = 'M') {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const parsed = this._parseOrderCommand(command);
            const symRes = await this.masterData.getNearestExpiryOption(parsed.index, parsed.strike, parsed.option_type);
            if (symRes.status === "error")
                return symRes;
            const values = {
                ordersource: "API",
                uid: this.username,
                actid: this.accountid,
                trantype: buy_or_sell,
                prd: product_type,
                exch: exchange,
                tsym: encodeURIComponent(symRes.trading_symbol),
                qty: String(parsed.quantity),
                dscqty: "0",
                prctyp: parsed.price_type,
                prc: String(parsed.price),
                trgprc: String(parsed.trigger_price),
                ret: "DAY",
                amo: "NO"
            };
            const resDict = await this.makeRequest('PlaceOrder', values);
            if (resDict.stat === 'Ok') {
                return this._appendMargin({
                    status: "success",
                    order_id: resDict.norenordno,
                    trading_symbol: symRes.trading_symbol,
                    message: "Order placed successfully"
                });
            }
            else {
                return { status: "error", data: resDict };
            }
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async placeManualSl(command) {
        return this.placeOrder('S', command);
    }
    async modifyOrder(order_id, exchange, tradingsymbol, quantity, price_type, price, trigger_price) {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const values = {
                ordersource: "API",
                uid: this.username,
                actid: this.accountid,
                exch: exchange,
                tsym: encodeURIComponent(tradingsymbol),
                norenordno: String(order_id)
            };
            if (quantity)
                values.qty = String(quantity);
            if (price_type)
                values.prctyp = price_type;
            if (price !== undefined)
                values.prc = String(price);
            if (trigger_price !== undefined)
                values.trgprc = String(trigger_price);
            const resDict = await this.makeRequest('ModifyOrder', values);
            if (resDict.stat === 'Ok') {
                return this._appendMargin({
                    status: "success",
                    order_id: resDict.norenordno || order_id,
                    trading_symbol: tradingsymbol,
                    message: "Order modified successfully"
                });
            }
            else {
                return { status: "error", data: resDict };
            }
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async cancelOrder(order_id) {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const values = {
                ordersource: "API",
                uid: this.username,
                norenordno: String(order_id)
            };
            const resDict = await this.makeRequest('CancelOrder', values);
            return this._appendMargin({ status: resDict.stat === 'Ok' ? "success" : "error", data: resDict });
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async getOrderBook() {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const values = { uid: this.username };
            const resDict = await this.makeRequest('OrderBook', values);
            return this._appendMargin({ status: "success", data: resDict });
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async exitOrder(order_id, product_type) {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const values = {
                ordersource: "API",
                uid: this.username,
                norenordno: String(order_id),
                prd: product_type
            };
            const resDict = await this.makeRequest('ExitSNOOrder', values);
            return this._appendMargin({ status: resDict.stat === 'Ok' ? "success" : "error", data: resDict });
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async getMargin() {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        try {
            const values = { uid: this.username, actid: this.accountid };
            const resDict = await this.makeRequest('Limits', values);
            if (resDict && resDict.cash !== undefined) {
                let available_margin = parseFloat(resDict.cash || "0") + parseFloat(resDict.payin || "0") + parseFloat(resDict.payout || "0");
                if (resDict.marginused !== undefined) {
                    available_margin -= parseFloat(resDict.marginused || "0");
                }
                return { status: "success", available_margin };
            }
            return { status: "error", message: "Failed to fetch margin" };
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
    async getOrderStatus(order_id) {
        const obRes = await this.getOrderBook();
        if (obRes.status !== "success" || !Array.isArray(obRes.data))
            return { status: "error", message: "Order book empty or error" };
        const order = obRes.data.find((o) => String(o.norenordno) === String(order_id));
        if (!order)
            return { status: "error", message: "Order not found in order book" };
        return this._appendMargin({
            status: "success",
            order_status: order.status,
            qty: order.qty,
            avgprc: order.avgprc ? parseFloat(order.avgprc) : null,
            tradingsymbol: order.tsym,
            rejreason: order.rejreason
        });
    }
    async placeAutoSl(order_id, index_name) {
        if (!this.loggedIn)
            return { status: "error", message: "Not logged in" };
        const orderStatus = await this.getOrderStatus(order_id);
        if (orderStatus.status !== "success")
            return orderStatus;
        const avg_buy_price = orderStatus.avgprc;
        const qty = parseInt(orderStatus.qty || "0", 10);
        const trading_symbol = orderStatus.tradingsymbol;
        if (!avg_buy_price || qty === 0 || !trading_symbol) {
            return { status: "error", message: "Could not find valid avgprc, qty, or tradingsymbol for this order." };
        }
        const index_sl_price = {
            "NIFTY": 10,
            "BANKNIFTY": 30,
            "FINNIFTY": 20,
            "MIDCPNIFTY": 10,
            "NIFTYNXT50": 20
        };
        const price_diff = index_sl_price[index_name.toUpperCase()];
        if (!price_diff)
            return { status: "error", message: `Unsupported index for auto-sl: ${index_name}` };
        let sl_price = Math.round((avg_buy_price - price_diff) * 100) / 100;
        sl_price = Math.round(sl_price * 20) / 20.0;
        if (sl_price <= 1)
            sl_price = 1.0;
        let trigger_price = Math.round((sl_price + 0.05) * 100) / 100;
        trigger_price = Math.round(trigger_price * 20) / 20.0;
        try {
            const values = {
                ordersource: "API",
                uid: this.username,
                actid: this.accountid,
                trantype: "S",
                prd: "M",
                exch: "NFO",
                tsym: encodeURIComponent(trading_symbol),
                qty: String(qty),
                dscqty: "0",
                prctyp: "SL-LMT",
                prc: String(sl_price),
                trgprc: String(trigger_price),
                ret: "DAY",
                amo: "NO"
            };
            const resDict = await this.makeRequest('PlaceOrder', values);
            if (resDict.stat === 'Ok') {
                return this._appendMargin({
                    status: "success",
                    sl_order_id: resDict.norenordno,
                    trading_symbol,
                    sl_price,
                    trigger_price,
                    message: "Auto SL placed successfully"
                });
            }
            else {
                return { status: "error", data: resDict };
            }
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
}
