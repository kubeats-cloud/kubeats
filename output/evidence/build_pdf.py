import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

root = Path(__file__).resolve().parent
entries = json.loads((root / 'manifest.json').read_text())
target = root.parent / 'pdf' / 'kubeats_feature_evidence.pdf'
target.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(target), pagesize=(1100, 850))
c.setTitle('KUbeats - Local feature evidence')
for index, entry in enumerate(entries, 1):
    c.setFont('Helvetica-Bold', 18)
    c.drawString(36, 815, entry['item'] + ' - ' + entry['caption'])
    c.setFont('Helvetica', 10)
    c.drawString(36, 793, 'Local app: 127.0.0.1:3000 | Synthetic seed data only | 22 October 2026')
    img = Image.open(root / entry['file'])
    width, height = img.size
    scale = min(1028 / width, 720 / height)
    c.drawImage(ImageReader(img), (1100-width*scale)/2, 55+(720-height*scale)/2, width*scale, height*scale)
    c.setFont('Helvetica', 9)
    c.drawString(36, 25, f"Page {index} | {entry['file']}")
    c.showPage()
c.save()
print(str(target))
