#!/usr/bin/env python3
import json
import sys
from html import escape
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, KeepTogether

input_path, output_path = sys.argv[1], sys.argv[2]
data = json.loads(Path(input_path).read_text(encoding='utf-8'))
font = 'Helvetica'
bold = 'Helvetica-Bold'
regular_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
bold_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
if regular_path.exists() and bold_path.exists():
    pdfmetrics.registerFont(TTFont('DejaVu', str(regular_path)))
    pdfmetrics.registerFont(TTFont('DejaVuBold', str(bold_path)))
    font, bold = 'DejaVu', 'DejaVuBold'

styles = getSampleStyleSheet()
base = ParagraphStyle('Base', parent=styles['BodyText'], fontName=font, fontSize=9.5, leading=13, textColor=colors.HexColor('#111827'), spaceAfter=5)
muted = ParagraphStyle('Muted', parent=base, textColor=colors.HexColor('#4b5563'))
h1 = ParagraphStyle('H1', parent=base, fontName=bold, fontSize=22, leading=26, spaceAfter=3)
h2 = ParagraphStyle('H2', parent=base, fontName=bold, fontSize=12.5, leading=16, spaceBefore=10, spaceAfter=6, borderColor=colors.HexColor('#d1d5db'), borderWidth=0, borderPadding=0)
h3 = ParagraphStyle('H3', parent=base, fontName=bold, fontSize=10.5, leading=14, spaceAfter=2)

doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=17*mm, leftMargin=17*mm, topMargin=16*mm, bottomMargin=16*mm, title=f"CV — {data.get('name','')}")
story = [Paragraph(escape(data.get('name','')), h1), Paragraph(escape(data.get('headline','')), muted)]
if data.get('summary'):
    story += [Spacer(1, 3*mm), Paragraph(escape(data['summary']), base)]

story += [Paragraph('Kompetencje', h2)]
facts = data.get('facts') or []
if facts:
    items = []
    for fact in facts:
        text = escape(str(fact.get('value','')))
        if fact.get('level'):
            text += ' — ' + escape(str(fact['level']))
        items.append(ListItem(Paragraph(text, base), leftIndent=10))
    story.append(ListFlowable(items, bulletType='bullet', leftIndent=14, bulletFontName=font, bulletFontSize=7))
else:
    story.append(Paragraph('Brak potwierdzonych kompetencji do CV.', muted))

story += [Paragraph('Doświadczenie', h2)]
experiences = data.get('experiences') or []
if experiences:
    for exp in experiences:
        date_bits = [exp.get('startDate')]
        date_bits.append('obecnie' if exp.get('current') else exp.get('endDate'))
        date_text = ' – '.join(str(x) for x in date_bits if x)
        block = [Paragraph(f"{escape(str(exp.get('title','')))} — {escape(str(exp.get('employer','')))}", h3)]
        if date_text:
            block.append(Paragraph(escape(date_text), muted))
        if exp.get('description'):
            block.append(Paragraph(escape(str(exp['description'])), base))
        story.append(KeepTogether(block))
        story.append(Spacer(1, 2*mm))
else:
    story.append(Paragraph('Brak uzupełnionego doświadczenia.', muted))

story += [Paragraph('Edukacja', h2)]
education = data.get('education') or []
if education:
    for ed in education:
        block = [Paragraph(escape(str(ed.get('institution',''))), h3)]
        detail = ' — '.join(str(x) for x in [ed.get('degree'), ed.get('field')] if x)
        if detail:
            block.append(Paragraph(escape(detail), base))
        date_text = ' – '.join(str(x) for x in [ed.get('startDate'), ed.get('endDate')] if x)
        if date_text:
            block.append(Paragraph(escape(date_text), muted))
        if ed.get('description'):
            block.append(Paragraph(escape(str(ed['description'])), base))
        story.append(KeepTogether(block))
        story.append(Spacer(1, 2*mm))
else:
    story.append(Paragraph('Brak uzupełnionej edukacji.', muted))

doc.build(story)
