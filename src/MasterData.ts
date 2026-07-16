import axios from 'axios';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

export class MasterData {
  private masterdata: any[] | null = null;
  private isDownloading: boolean = false;

  async downloadMasterData(): Promise<any> {
    if (this.masterdata || this.isDownloading) {
      return { status: "success", message: "Master data already loaded or downloading" };
    }
    
    this.isDownloading = true;
    try {
      console.error("Downloading NFO master data...");
      const response = await axios.get("https://api.shoonya.com/NFO_symbols.txt.zip", {
        responseType: "arraybuffer",
      });

      const zip = new AdmZip(Buffer.from(response.data));
      const zipEntries = zip.getEntries();
      if (zipEntries.length === 0) {
        throw new Error("No files in the ZIP archive.");
      }

      const csvData = zipEntries[0].getData().toString("utf8");
      
      this.masterdata = parse(csvData, {
        columns: true,
        skip_empty_lines: true,
      });

      console.error(`Master data downloaded and parsed: ${this.masterdata!.length} records.`);
      this.isDownloading = false;
      return { status: "success", message: "Master data downloaded" };
    } catch (error: any) {
      this.isDownloading = false;
      console.error(`Error downloading master data: ${error.message}`);
      return { status: "error", message: error.message };
    }
  }

  async getNearestExpiryOption(index: string, strike: number, option_type: string): Promise<any> {
    if (!this.masterdata) {
      const res = await this.downloadMasterData();
      if (res.status === "error") return res;
    }

    try {
      // Filter for symbol and OPTIDX
      let df = this.masterdata!.filter(
        (row: any) => row.Symbol === index && row.Instrument === "OPTIDX"
      );

      if (df.length === 0) {
        return { status: "error", message: `No data found for index ${index}` };
      }

      // Convert Expiry to timestamps to find the minimum
      const expDates = df.map((row: any) => new Date(row.Expiry).getTime());
      const minExpTime = Math.min(...expDates);
      const minExpDateStr = df.find((row: any) => new Date(row.Expiry).getTime() === minExpTime)!.Expiry;

      // Filter for strike, option type, and nearest expiry
      df = df.filter(
        (row: any) =>
          row.Expiry === minExpDateStr &&
          parseFloat(row.StrikePrice) === strike &&
          row.OptionType === option_type.toUpperCase()
      );

      if (df.length > 0) {
        const token = df[0].Token;
        const tsymbol = df[0].TradingSymbol;
        return {
          status: "success",
          token: String(token),
          trading_symbol: String(tsymbol),
          expiry: minExpDateStr.toUpperCase(),
        };
      } else {
        return { status: "error", message: `No option found for strike ${strike} ${option_type}` };
      }
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  }
}
