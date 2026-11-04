"""Reproducible fictional DOCX fixture, generated with python-docx (not a runtime dependency)."""
from pathlib import Path
from docx import Document

doc = Document()
doc.core_properties.author = 'Saleschild fictional fixture'
doc.core_properties.last_modified_by = 'Saleschild fictional fixture'
doc.add_heading('Device preparation', level=1)
doc.add_paragraph('Before using the fictional training device, inspect its safety indicator and verify the local checklist.')
doc.add_paragraph('Use the approved practice mode; do not operate real equipment.', style='List Bullet')
table=doc.add_table(rows=1,cols=2)
table.rows[0].cells[0].text='Check'
table.rows[0].cells[1].text='Owner'
row=table.add_row().cells
row[0].text='Indicator 🧰'
row[1].text='Operations'
doc.add_heading('Escalation', level=2)
doc.add_paragraph('If the fictional indicator is amber, pause the simulation and contact the designated training coordinator.')
doc.save(Path(__file__).with_name('structured-guide.docx'))
