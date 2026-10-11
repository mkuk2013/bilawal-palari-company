'use strict';
/* Minimal XLSX writer: stored (uncompressed) zip + inline strings,
   with the same professional invoice styling as the PHP exporter
   (navy/gold theme, borders, zebra rows, merges, print setup).
   rows: array of rows; each cell = [value, kind, style];
   kind 's' text | 'n' number; style = cellXfs index (see stylesXml). */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(files).length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>'
  + '<fonts count="11">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><i/><sz val="10"/><color rgb="FFD9E2F3"/><name val="Calibri"/></font>'
  + '<font><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="14"/><color rgb="FF0A1E46"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FF0A1E46"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="12"/><color rgb="FFF5C542"/><name val="Calibri"/></font>'
  + '<font><i/><sz val="10"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="7">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF0A1E46"/><bgColor rgb="FF0A1E46"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F5FA"/><bgColor rgb="FFF2F5FA"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor rgb="FFFFF3D6"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF5"/><bgColor rgb="FFE8EDF5"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor rgb="FFF7F9FC"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="4">'
  + '<border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFBFC9D9"/></left><right style="thin"><color rgb="FFBFC9D9"/></right><top style="thin"><color rgb="FFBFC9D9"/></top><bottom style="thin"><color rgb="FFBFC9D9"/></bottom><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFBFC9D9"/></left><right style="thin"><color rgb="FFBFC9D9"/></right><top style="medium"><color rgb="FF0A1E46"/></top><bottom style="thin"><color rgb="FFBFC9D9"/></bottom><diagonal/></border>'
  + '<border><left/><right/><top/><bottom style="medium"><color rgb="FFF5C542"/></bottom><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="27">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="6" fillId="0" borderId="3" xfId="0"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="7" fillId="4" borderId="1" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="165" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="7" fillId="5" borderId="2" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="7" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="165" fontId="7" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="8" fillId="2" borderId="1" xfId="0" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="164" fontId="9" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="165" fontId="8" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf>'
  + '</cellXfs></styleSheet>';

function rowsToXlsx(rows, sheetName, merges = [], heights = {}) {
  let sheetRows = '';
  rows.forEach((row, ri) => {
    const rn = ri + 1;
    const hAttr = heights[rn] ? ` ht="${heights[rn]}" customHeight="1"` : '';
    sheetRows += `<row r="${rn}"${hAttr}>`;
    row.forEach((cell, ci) => {
      if (!cell) return;
      const [val, kind, style] = cell;
      const ref = colName(ci) + rn;
      const sAttr = style > 0 ? ` s="${style}"` : '';
      if (kind === 'n') sheetRows += `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
      else sheetRows += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
    });
    sheetRows += '</row>';
  });
  const widths = [8, 14, 13, 12, 34, 9, 14, 15, 12, 17];
  let cols = '<cols>';
  widths.forEach((w, i) => { cols += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`; });
  cols += '</cols>';
  let mergeXml = '';
  if (merges.length) {
    mergeXml = `<mergeCells count="${merges.length}">` + merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>';
  }
  const name = String(sheetName).replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetPrp><pageSetUpPr fitToPage="1"/></sheetPrp>'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="10" topLeftCell="A11" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A11" sqref="A11"/></sheetView></sheetViews>'
    + cols
    + `<sheetData>${sheetRows}</sheetData>`
    + mergeXml
    + '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': STYLES_XML,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

module.exports = { rowsToXlsx };
