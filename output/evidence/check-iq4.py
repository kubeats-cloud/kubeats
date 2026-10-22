import json,zipfile,xml.etree.ElementTree as ET,html
from pathlib import Path
r=Path(__file__).resolve().parent
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(r/'IQ4-field-visits.xlsx') as z:
    xml=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
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
assert rows[0]==['Institution Name','Check-In Date','Check-In Time','Check-Out Time','Location'],rows[0]
f=json.loads((r/'fixtures.json').read_text())
assert rows[1:],'No actual visits exported'
assert all(len(row)==5 for row in rows),'Extra columns'
assert all(row[1]==f['today'] for row in rows[1:]),'Range not applied to check-in date'
assert sum(row[0]=='Audit Open School' for row in rows[1:])==2,'Deleted institute history or repeat visits lost'
assert all(row[2] and row[3] and row[4] for row in rows[1:] if row[0]=='Audit Open School')
html_rows=''.join('<tr>'+''.join('<'+('th' if i==0 else 'td')+'>'+html.escape(v)+'</'+('th' if i==0 else 'td')+'>' for v in row)+'</tr>' for i,row in enumerate(rows))
(r/'IQ4-workbook.html').write_text('<!doctype html><meta charset="utf-8"><style>body{font:18px Arial;padding:35px;color:#172033}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:18px;text-align:left}th{background:#eef2ff}h1{font-size:24px}</style><h1>IQ4 - Downloaded Field Visit Report</h1><p>Actual Excel cells, '+f['today']+' | Local synthetic seed data</p><table>'+html_rows+'</table>',encoding='utf-8')
print('PASS IQ4 Excel: exact 5 columns, check-in dates in range, both saved visits retained after institute deletion')
