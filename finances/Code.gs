/**
 * Google Apps Script for the finances widget. It runs inside the spreadsheet, not on
 * GitHub Pages: paste it into Extensions → Apps Script and deploy it as a web app
 * (see README.md). Only the values built below ever leave the sheet.
 */

// Each entry is an A1 address or the name of a named range (Data → Named ranges).
// Named ranges keep working when a table is moved.
const RANGES = {
  spendPerMonth: "Charts!B4:F16", // header row + one row per month, one column per year
  spendBreakdown: "Charts!I4:J16", // header row + one row per category
  averageSpend: "Charts!L6",
  patrimony: "Charts!P4:Q40",
  averagePatrimonyGrowth: "Charts!T5",
  totalPatrimony: "Charts!T16",
};

function doGet() {
  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    payload = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function buildPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timeZone = ss.getSpreadsheetTimeZone();

  const values = (key) => {
    const ref = RANGES[key];
    const range = ss.getRangeByName(ref) || ss.getRange(ref);
    return range.getValues();
  };
  const number = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const single = (key) => number(values(key)[0][0]);

  const [spendHeader, ...spendRows] = values("spendPerMonth");
  const monthRows = spendRows.filter((row) => row[0] !== "");
  const years = [];
  spendHeader.forEach((header, col) => {
    const year = String(header).match(/\d{4}/);
    if (col > 0 && year)
      years.push({
        year: year[0],
        values: monthRows.map((row) => number(row[col])),
      });
  });

  const breakdown = values("spendBreakdown")
    .slice(1)
    .filter((row) => row[0] !== "" && number(row[1]) !== null)
    .map((row) => ({ type: String(row[0]), value: row[1] }));

  const series = values("patrimony")
    .slice(1)
    .map((row) => ({
      month: monthKey(row[0], timeZone),
      value: number(row[1]),
    }))
    .filter((point) => point.month && point.value !== null);

  return {
    spend: {
      average: single("averageSpend"),
      months: monthRows.map((row) => String(row[0])),
      years,
      breakdown,
    },
    patrimony: {
      total: single("totalPatrimony"),
      averageGrowth: single("averagePatrimonyGrowth"),
      series,
    },
  };
}

// The month column may hold real dates or "MM/YYYY" text; both become "YYYY-MM".
function monthKey(value, timeZone) {
  if (value instanceof Date)
    return Utilities.formatDate(value, timeZone, "yyyy-MM");
  const match = String(value).match(/^(\d{1,2})\/(\d{4})$/);
  return match ? `${match[2]}-${match[1].padStart(2, "0")}` : null;
}
