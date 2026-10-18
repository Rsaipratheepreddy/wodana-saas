"""Extract only reusable artwork and terms from the user-provided PDF, never client data."""
import base64
import io
import json
import sys
from pathlib import Path
from pypdf import PdfReader
import pdfplumber

source = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
reader = PdfReader(source)
assets = {}
for name, page, index, size in [
    ('logo',0,0,900), ('monogram',0,1,200), ('introduction',1,0,1400),
    ('termsOne',5,0,450), ('termsTwo',5,3,450), ('termsThree',5,2,450),
    ('closing',6,0,1400), ('tableLogo',3,0,300),
]:
    image = reader.pages[page].images[index].image.copy()
    # Respect the clipping frames in the supplied PDF, rather than recropping the
    # underlying photos to a different composition in the application.
    clips={'introduction':(0,0,595.5,834.42),'termsOne':(25.5,43,195.5,271),
           'termsTwo':(211.5,43,381.5,271),'termsThree':(394,43,564,271),
           'closing':(0,0,595.5,627)}
    if name in clips:
        with pdfplumber.open(source) as document:
            geometry=document.pages[page].images[index]
        left,top,right,bottom=clips[name]
        sx=image.width/geometry['width']; sy=image.height/geometry['height']
        image=image.crop((max(0,(left-geometry['x0'])*sx),max(0,(top-geometry['top'])*sy),
                          min(image.width,(right-geometry['x0'])*sx),min(image.height,(bottom-geometry['top'])*sy)))
    image.thumbnail((size,size))
    output = io.BytesIO()
    image.save(output,format='WEBP',quality=82)
    assets[name] = 'data:image/webp;base64,' + base64.b64encode(output.getvalue()).decode()
with pdfplumber.open(source) as document:
    page = document.pages[5]
    assets['termsLeft'] = page.crop((0,325,298,795)).extract_text(x_tolerance=1)
    assets['termsRight'] = page.crop((303,325,595,795)).extract_text(x_tolerance=1)
destination = root / 'apps/web/lib/commercial/proposal-reference.json'
destination.write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n')
print(f'Extracted reusable reference artwork and terms ({destination.stat().st_size:,} bytes).')
