import json,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
r=Path(__file__).resolve().parent
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(r/'A1-filtered.xlsx') as z:
    xml=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    rows=[]
    for row in xml.findall('.//s:sheetData/s:row',ns):
        cells=[]
        for c in row:
            v=c.find('s:v',ns)
            if c.get('t')=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
            elif c.get('t')=='s':value=strings[int(v.text)]
            else:value=v.text if v is not None else ''
            cells.append(value)
        rows.append(cells)
names=['Meetings','Sessions','Campus Visits','Olympiad Registrations','Applications','Admissions']
assert rows[0]==['Institute']+[f'{a} {s}' for a in names for s in ['Open','Closed']], rows[0]
assert rows[1:]==json.loads((r/'A1-table.json').read_text()),'Workbook differs from filtered UI'
print('PASS A1 filtered Excel has exact headings and matches every displayed cell')
