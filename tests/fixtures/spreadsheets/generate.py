"""Reproducible fictional fixtures generated with openpyxl, not a vendor UI claim."""
from pathlib import Path
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
import zipfile,xml.etree.ElementTree as ET
root=Path(__file__).parent
headers=['Topic','Category','Subtopic','Learning Objective','Knowledge Content','Process Steps','Example Scenario','Correct Response','Common Mistakes','Assessment Question','Answer Options','Correct Answer','Difficulty','Source Reference','Effective Date','Last Reviewed','Content Owner']
values=['設備の点検 🧰','Operations','Checks','Explain the fictional inspection','Inspect the fictional instrument and record its displayed reading before use.','- Inspect the instrument','A fictional inspection is due.','Record the reading.','Skipping the inspection.','What is recorded?','Reading | Password','Reading','Beginner','https://example.test/manual',datetime(2026,1,1),datetime(2026,1,1),'Fictional team']
w=Workbook();w.active.title='Instructions';w.active.append(['Fictional test instructions']);s=w.create_sheet('Knowledge Records');s.append(headers);s.append(values);s['A2']=CellRichText('設備の',TextBlock(InlineFont(b=True),'点検 🧰'));s['N2'].hyperlink='https://example.test/manual';s['O2'].number_format='yyyy-mm-dd';s['P2'].number_format='yyyy-mm-dd';s['A5000'].font=Font(b=True)
t=w.create_sheet('Second source');t.append(headers);t.append(values);t['A2']='Another fictional topic';extra=w.create_sheet('Summary');extra['A1']='=1+1';w.save(root/'openpyxl-inline.xlsx')
# Independent shared-string and prefixed-namespace OOXML structure, not a claim of a Google/LibreOffice export.
ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
with zipfile.ZipFile(root/'openpyxl-inline.xlsx') as z: entries={n:z.read(n) for n in z.namelist()}
shared=ET.Element('{'+ns+'}sst',{'count':'0','uniqueCount':'0'});strings=[]
for name,data in list(entries.items()):
 if name.startswith('xl/worksheets/') and name.endswith('.xml'):
  tree=ET.fromstring(data)
  for cell in tree.findall('.//{'+ns+'}c'):
   if cell.attrib.get('t')=='inlineStr':
    text=''.join(cell.find('{'+ns+'}is').itertext());cell.remove(cell.find('{'+ns+'}is'));cell.set('t','s');ET.SubElement(cell,'{'+ns+'}v').text=str(len(strings));strings.append(text);ET.SubElement(ET.SubElement(shared,'{'+ns+'}si'),'{'+ns+'}t').text=text
  entries[name]=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
shared.set('count',str(len(strings)));shared.set('uniqueCount',str(len(strings)));entries['xl/sharedStrings.xml']=ET.tostring(shared,encoding='utf-8',xml_declaration=True)
ct=ET.fromstring(entries['[Content_Types].xml']);ET.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',{'PartName':'/xl/sharedStrings.xml','ContentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'});entries['[Content_Types].xml']=ET.tostring(ct,encoding='utf-8')
rels=ET.fromstring(entries['xl/_rels/workbook.xml.rels']);ET.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'shared','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings','Target':'sharedStrings.xml'});entries['xl/_rels/workbook.xml.rels']=ET.tostring(rels,encoding='utf-8')
with zipfile.ZipFile(root/'shared-prefixed.xlsx','w',zipfile.ZIP_DEFLATED) as z:
 for n,data in entries.items():z.writestr(n,data)
