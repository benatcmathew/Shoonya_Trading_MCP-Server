import axios from 'axios';
import { sha256 } from 'js-sha256';
import { TOTP } from 'totp-generator';
import puppeteer from 'puppeteer';
import { MasterData } from './MasterData.js';
const BASE_URL = 'https://api.shoonya.com/NorenWClientAPI/';
const OAUTH_LOGIN_URL = 'https://api.shoonya.com/OAuthlogin/investor-entry-level/login';
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
    /**
     * Get OAuth auth code by automating the login page with Puppeteer.
     * Fills in user_id, password, and TOTP on the OAuth page, clicks LOGIN,
     * and intercepts the redirect URL containing the auth code.
     */
    async getAuthCode(user_id, password, totp, client_id) {
        const loginUrl = `${OAUTH_LOGIN_URL}?api_key=${encodeURIComponent(client_id)}&route_to=${encodeURIComponent(user_id)}`;
        let authCode = null;
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        });
        try {
            const page = await browser.newPage();
            // Set up request interception to capture the auth code from redirects
            page.on('request', (request) => {
                const url = request.url();
                if (url.includes('code=') && url.toLowerCase().includes('shoonya')) {
                    try {
                        const urlObj = new URL(url);
                        const code = urlObj.searchParams.get('code');
                        if (code) {
                            authCode = code;
                        }
                    }
                    catch {
                        // URL parsing failed, try regex fallback
                        const match = url.match(/[?&]code=([^&]+)/);
                        if (match) {
                            authCode = match[1];
                        }
                    }
                }
            });
            // Also intercept responses for redirect URLs
            page.on('response', (response) => {
                const url = response.url();
                if (url.includes('code=') && url.toLowerCase().includes('shoonya')) {
                    try {
                        const urlObj = new URL(url);
                        const code = urlObj.searchParams.get('code');
                        if (code) {
                            authCode = code;
                        }
                    }
                    catch {
                        const match = url.match(/[?&]code=([^&]+)/);
                        if (match) {
                            authCode = match[1];
                        }
                    }
                }
            });
            // Navigate to the OAuth login page
            await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            // Small delay to let the page fully render
            await new Promise((resolve) => setTimeout(resolve, 1000));
            // Fill credentials and click LOGIN — all inside the browser context
            const fillResult = await page.evaluate((uid, pwd, otp) => {
                // Find all visible, fillable inputs
                const allInputs = Array.from(document.querySelectorAll('input'));
                const visibleInputs = allInputs.filter((input) => {
                    const type = (input.getAttribute('type') || 'text').toLowerCase();
                    if (['hidden', 'checkbox', 'radio', 'submit', 'button'].includes(type))
                        return false;
                    const style = window.getComputedStyle(input);
                    return style.display !== 'none' && style.visibility !== 'hidden' && input.offsetParent !== null;
                });
                if (visibleInputs.length < 3) {
                    return { ok: false, error: `Expected 3 visible inputs, found ${visibleInputs.length}` };
                }
                // Helper to set input value and trigger React/Vue change events
                const fillInput = (el, value) => {
                    el.focus();
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                };
                // input[0] = User ID, input[1] = Password, input[2] = TOTP
                fillInput(visibleInputs[0], uid);
                fillInput(visibleInputs[1], pwd);
                fillInput(visibleInputs[2], otp);
                // Click the LOGIN button
                const buttons = Array.from(document.querySelectorAll('button'));
                const loginBtn = buttons.find((btn) => btn.textContent?.trim().toUpperCase() === 'LOGIN');
                if (loginBtn) {
                    loginBtn.click();
                    return { ok: true };
                }
                const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
                if (submitBtn) {
                    submitBtn.click();
                    return { ok: true };
                }
                return { ok: false, error: 'Could not find LOGIN button' };
            }, user_id, password, totp);
            if (!fillResult.ok) {
                throw new Error(fillResult.error || 'Failed to fill OAuth login form');
            }
            // Wait for the auth code to be captured via request interception
            const startTime = Date.now();
            const timeout = 60000; // 60 seconds
            while (!authCode && (Date.now() - startTime) < timeout) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (!authCode) {
                throw new Error('Timed out waiting for OAuth auth code (60s). Login may have failed or TOTP expired.');
            }
            return authCode;
        }
        finally {
            await browser.close();
        }
    }
    /**
     * Exchange an OAuth auth code for an access token via GenAcsTok.
     */
    async exchangeAuthCode(authCode, user_id, client_id, secret_code) {
        const checksum = sha256(client_id + secret_code + authCode);
        const payload = 'jData=' + JSON.stringify({
            code: authCode,
            checksum: checksum,
            uid: user_id,
        });
        const res = await axios.post(`${BASE_URL}GenAcsTok`, payload, {
            validateStatus: () => true,
        });
        return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    }
    /**
     * Login to Shoonya using the OAuth headless browser flow.
     * 1. Generate TOTP
     * 2. Automate OAuth login page with Puppeteer to get auth code
     * 3. Exchange auth code for access token via GenAcsTok
     */
    async login(user_id, password, totp_key, client_id, secret_code, imei) {
        try {
            const { otp } = await TOTP.generate(totp_key);
            console.error(`[OAuth] Starting headless browser login for ${user_id}...`);
            // Step 1: Get auth code via headless browser
            const authCode = await this.getAuthCode(user_id, password, otp, client_id);
            console.error(`[OAuth] Auth code obtained successfully.`);
            // Step 2: Exchange auth code for access token
            const resDict = await this.exchangeAuthCode(authCode, user_id, client_id, secret_code);
            if (resDict.stat === 'Ok' || resDict.susertoken) {
                this.loggedIn = true;
                this.username = resDict.uname || user_id;
                this.accountid = resDict.actid || user_id;
                this.susertoken = resDict.susertoken;
                console.error(`[OAuth] Login successful. Token obtained.`);
                // Background master data download
                this.masterData.downloadMasterData().catch((e) => console.error("Background MD fail:", e));
                return { status: "success", message: "Successfully logged in to Shoonya via OAuth, master data downloading..." };
            }
            else {
                return { status: "error", message: resDict.emsg || "GenAcsTok failed: " + JSON.stringify(resDict) };
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
        return this.login(credentials.user_id, credentials.password, credentials.totp_key, credentials.client_id, credentials.secret_code, credentials.imei);
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
