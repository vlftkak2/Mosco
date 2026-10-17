const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'B4232D' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FFF3F3' } },
  alignment: { vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: 'E5BFC2' } },
    bottom: { style: 'thin', color: { rgb: 'E5BFC2' } },
    left: { style: 'thin', color: { rgb: 'E5BFC2' } },
    right: { style: 'thin', color: { rgb: 'E5BFC2' } },
  },
};

export function applyExcelHeaderStyle(worksheet, columnCount) {
  for (let column = 0; column < columnCount; column += 1) {
    let columnNumber = column + 1;
    let columnName = '';
    while (columnNumber > 0) {
      const remainder = (columnNumber - 1) % 26;
      columnName = String.fromCharCode(65 + remainder) + columnName;
      columnNumber = Math.floor((columnNumber - 1) / 26);
    }
    const cellAddress = `${columnName}1`;
    const cell = worksheet[cellAddress];
    if (cell) cell.s = HEADER_STYLE;
  }
  worksheet['!rows'] = worksheet['!rows'] || [];
  worksheet['!rows'][0] = { hpt: 22 };
}
