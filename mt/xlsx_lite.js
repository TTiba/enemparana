/* Gerador mínimo de .xlsx (OOXML) sem dependência externa — zip "store"
 * (sem compressão, então não precisa reimplementar DEFLATE) + XML mínimo de
 * planilha (uma aba, cabeçalho em negrito, larguras de coluna fixas).
 * Suficiente pra exportar uma tabela de algumas centenas de linhas; não é
 * um writer de propósito geral.
 */
(function () {
  "use strict";

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
  function concatBytes(chunks) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  function dosDateTime(d) {
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const date = ((Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { time, date };
  }

  /* zip "store": cada arquivo entra sem compressão — implementação fica em
   * ~40 linhas em vez de precisar de DEFLATE só pra um arquivo de poucos KB. */
  function zipStore(files) {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localChunks = [], centralChunks = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = concatBytes([
        Uint8Array.from([0x50, 0x4B, 0x03, 0x04]),
        Uint8Array.from(u16(20)), Uint8Array.from(u16(0)), Uint8Array.from(u16(0)),
        Uint8Array.from(u16(time)), Uint8Array.from(u16(date)),
        Uint8Array.from(u32(crc)), Uint8Array.from(u32(data.length)), Uint8Array.from(u32(data.length)),
        Uint8Array.from(u16(nameBytes.length)), Uint8Array.from(u16(0)),
        nameBytes, data,
      ]);
      localChunks.push(local);
      centralChunks.push(concatBytes([
        Uint8Array.from([0x50, 0x4B, 0x01, 0x02]),
        Uint8Array.from(u16(20)), Uint8Array.from(u16(20)), Uint8Array.from(u16(0)), Uint8Array.from(u16(0)),
        Uint8Array.from(u16(time)), Uint8Array.from(u16(date)),
        Uint8Array.from(u32(crc)), Uint8Array.from(u32(data.length)), Uint8Array.from(u32(data.length)),
        Uint8Array.from(u16(nameBytes.length)), Uint8Array.from(u16(0)), Uint8Array.from(u16(0)),
        Uint8Array.from(u16(0)), Uint8Array.from(u16(0)), Uint8Array.from(u32(0)),
        Uint8Array.from(u32(offset)), nameBytes,
      ]));
      offset += local.length;
    }
    const localDir = concatBytes(localChunks);
    const centralDir = concatBytes(centralChunks);
    const end = concatBytes([
      Uint8Array.from([0x50, 0x4B, 0x05, 0x06]),
      Uint8Array.from(u16(0)), Uint8Array.from(u16(0)),
      Uint8Array.from(u16(files.length)), Uint8Array.from(u16(files.length)),
      Uint8Array.from(u32(centralDir.length)), Uint8Array.from(u32(localDir.length)),
      Uint8Array.from(u16(0)),
    ]);
    return concatBytes([localDir, centralDir, end]);
  }

  function escXml(s) {
    return String(s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  }
  function colName(n) {
    let s = "", m = n + 1;
    while (m > 0) {
      const r = (m - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      m = Math.floor((m - 1) / 26);
    }
    return s;
  }
  function celXml(ref, valor, styleAttr) {
    if (valor == null || valor === "") return "";
    const s = styleAttr ? ` s="${styleAttr}"` : "";
    if (typeof valor === "number" && Number.isFinite(valor)) {
      return `<c r="${ref}"${s}><v>${valor}</v></c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t>${escXml(valor)}</t></is></c>`;
  }
  function linhaXml(valores, rowNum, ncols, styleAttr) {
    let cells = "";
    for (let j = 0; j < valores.length; j++) cells += celXml(`${colName(j)}${rowNum}`, valores[j], styleAttr);
    return `<row r="${rowNum}" spans="1:${ncols}">${cells}</row>`;
  }
  function sheetXml(header, rows, larguras) {
    const ncols = header.length;
    const total = rows.length + 1;
    const cols = (larguras || []).map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    let body = linhaXml(header, 1, ncols, "1");
    rows.forEach((r, i) => { body += linhaXml(r, i + 2, ncols, ""); });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${colName(ncols - 1)}${total}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${body}</sheetData>
</worksheet>`;
  }

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  function workbookXml(sheetName) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  }
  const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function build(sheetName, header, rows, larguras) {
    const enc = new TextEncoder();
    const files = [
      { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
      { name: "_rels/.rels", data: enc.encode(RELS_ROOT) },
      { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheetName)) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
      { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(header, rows, larguras)) },
    ];
    return zipStore(files);
  }

  function baixar(filename, sheetName, header, rows, larguras) {
    const bytes = build(sheetName, header, rows, larguras);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.XlsxLite = { build, baixar };
})();
