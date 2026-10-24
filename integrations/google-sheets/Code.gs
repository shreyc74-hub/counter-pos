/**
 * Counter POS → Google Sheet backup.
 *
 * Paste this into the sheet's Apps Script (Extensions → Apps Script), set SECRET below,
 * then Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Copy the web app URL into Vercel as SHEETS_WEBHOOK_URL and the same secret as
 * SHEETS_SECRET. Tabs (Bills, Items, Expenses, Days, Events) are created on first use.
 * Every row has an id in column A, so a row sent twice is only written once.
 */
const SECRET = 'CHANGE-ME';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return reply({ ok: false, error: 'Wrong SHEETS_SECRET (it must match SECRET in the Apps Script).' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const byTab = {};
    (body.rows || []).forEach(function (r) {
      (byTab[r.sheet] = byTab[r.sheet] || []).push(r);
    });
    Object.keys(byTab).forEach(function (tab) {
      const rows = byTab[tab];
      let sh = ss.getSheetByName(tab);
      if (!sh) {
        sh = ss.insertSheet(tab);
        sh.appendRow(['id'].concat(rows[0].headers));
        sh.setFrozenRows(1);
      }
      const last = sh.getLastRow();
      const seen = {};
      if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (v) { seen[String(v[0])] = true; });
      const fresh = rows.filter(function (r) {
        if (seen[r.id]) return false;
        seen[r.id] = true;
        return true;
      });
      if (!fresh.length) return;
      const width = 1 + Math.max.apply(null, fresh.map(function (r) { return r.values.length; }));
      const values = fresh.map(function (r) {
        const row = [r.id].concat(r.values);
        while (row.length < width) row.push('');
        return row;
      });
      sh.getRange(last + 1, 1, values.length, width).setValues(values);
    });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: 'Sheet script error: ' + err });
  } finally {
    lock.releaseLock();
  }
}

// Open the web app URL in a browser to check it's deployed: it should say {"ok":true}.
function doGet() {
  return reply({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
