"""Writes the free TV schedule template: public/downloads/tv-schedule-template.xlsx.

The page /tools/tv-schedule-template offers it for download (docs/marketing/seo-plan.md, free tools).
Sample data: src/data/tv-schedule-sample.json, which the page also shows. Needs Python 3 with
openpyxl (pip install openpyxl). Run from apps/site: python scripts/tv-schedule-template.py

Every time is kept as a whole number of frames in hidden helper columns (N:R on "Day playlist"),
the way broadcast systems count, so start times stay frame-accurate. Only functions that Excel,
Google Sheets and LibreOffice all have: IF, AND, OR, SUM, SUMIFS, COUNT, ROUND, INT, MOD, ABS, N, TEXT.
"""
import datetime as dt
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

SITE = Path(__file__).resolve().parent.parent
SAMPLE = json.loads((SITE / 'src/data/tv-schedule-sample.json').read_text(encoding='utf-8'))
OUT = SITE / 'public/downloads/tv-schedule-template.xlsx'
PAGE = 'https://9eye.org/tools/tv-schedule-template'

FIRST, LAST = 9, 308  # playlist rows (300)
DAY = "'Day playlist'"

INK = '18181B'
GREY = '71717A'
ACCENT = '2563EB'
fill = lambda c: PatternFill('solid', start_color=c, end_color=c)
YOURS = fill('FFFBEB')  # cells to type in
HEAD = fill(INK)
LINE = Side(style='thin', color='E4E4E7')
BOX = Border(bottom=LINE)


def seconds(text: str) -> int:
    h, m, s = (int(x) for x in text.split(':'))
    return h * 3600 + m * 60 + s


def tc(x: str) -> str:
    """Frames in the cell or expression x as HH:MM:SS:FF (non-drop) at the frame rate in $B$6 (Day playlist only)."""
    f = '$B$6'
    return (f'TEXT(INT({x}/({f}*3600)),"00")&":"&TEXT(INT(MOD({x},{f}*3600)/({f}*60)),"00")'
            f'&":"&TEXT(INT(MOD({x},{f}*60)/{f}),"00")&":"&TEXT(MOD({x},{f}),"00")')


def header(ws, row: int, labels: list[str], widths: list[float]):
    for i, (label, width) in enumerate(zip(labels, widths), start=1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = HEAD
        c.alignment = Alignment(vertical='center', wrap_text=True)
        if width:
            ws.column_dimensions[c.column_letter].width = width
    ws.row_dimensions[row].height = 30


def title(ws, text: str, note: str):
    ws['A1'] = text
    ws['A1'].font = Font(bold=True, size=16, color=INK)
    ws['A2'] = note
    ws['A2'].font = Font(italic=True, color=GREY)


wb = Workbook()

# ------------------------------------------------------------------------------------------------
# Start here
start = wb.active
start.title = 'Start here'
start.column_dimensions['A'].width = 110
lines = [
    ('TV schedule template', 'h1'),
    (f'Free from 9eye. The latest version and help: {PAGE}', 'link'),
    ('', ''),
    ('How to use it', 'h2'),
    ('1. Day playlist: set the day start and the frame rate at the top. Type one row per item: its type, title, '
     'and duration as h:mm:ss (for example 0:22:30), plus frames if you need them. Start times and timecodes fill in by themselves.', ''),
    ('2. Planned start: for an item with a fixed time, such as the news at 07:00, type that time. "Off by" shows how early '
     'or late the item really starts, to the frame.', ''),
    ('3. The box at the top shows how much of the day is scheduled, what is left to fill (or how far it runs over) and when the day ends.', ''),
    ('4. Ad minutes: commercial, promo, sponsorship and programme minutes in every clock hour, with a warning above your limit per hour.', ''),
    ('5. Week grid: the channel\'s week in half-hour slots. Titles that start with News, Kids, Series, Movie, Sport, Music or '
     'Magazine get a colour of their own.', ''),
    ('The yellow cells are yours to fill. The sample day and week are examples: clear the yellow cells and start your own.', ''),
    ('', ''),
    ('Good to know', 'h2'),
    ('- Type durations with hours: 0:22:30. Excel reads 22:30 as 22 hours and 30 minutes.', ''),
    ('- Timecode is non-drop (HH:MM:SS:FF). For 29.97 fps drop-frame timecode, use the free timecode calculator on 9eye.org.', ''),
    ('- An item counts in the hour where it starts, so a break that crosses the hour counts in the first hour.', ''),
    ('- Hidden columns N to R of the Day playlist sheet hold the frame counts the formulas use. Leave them in place.', ''),
    ('- The template works in Excel, Google Sheets (File > Import) and LibreOffice.', ''),
    ('', ''),
    ('When a spreadsheet gets too small', 'h2'),
    ('9eye is broadcast scheduling and traffic software: week templates, series that place themselves, ad and promo '
     'placement, frame-accurate playlists, checks before air, playout export and as-run. https://9eye.org/platform', ''),
    ('Need your own tool, a check or a connection to your playout system? 9eye Studio builds it: https://9eye.org/studio', ''),
    ('', ''),
    ('Free to use, change and share.', 'small'),
]
for i, (text, kind) in enumerate(lines, start=1):
    c = start.cell(row=i, column=1, value=text)
    c.alignment = Alignment(wrap_text=True, vertical='top')
    if kind == 'h1':
        c.font = Font(bold=True, size=18, color=INK)
    elif kind == 'h2':
        c.font = Font(bold=True, size=13, color=INK)
    elif kind == 'link':
        c.font = Font(color=ACCENT, underline='single')
        c.hyperlink = PAGE
    elif kind == 'small':
        c.font = Font(italic=True, color=GREY)

# ------------------------------------------------------------------------------------------------
# Day playlist
day = wb.create_sheet('Day playlist')
title(day, 'Day playlist', 'Yellow cells are yours to fill. Start times, timecodes and checks fill in by themselves. Help: the "Start here" sheet.')

settings = [
    ('Channel', SAMPLE['channel'], None),
    ('Date', dt.date.fromisoformat(SAMPLE['date']), 'yyyy-mm-dd'),
    ('Day starts at', seconds(SAMPLE['dayStart']) / 86400, 'hh:mm:ss'),
    ('Frame rate (fps)', SAMPLE['fps'], '0'),
]
for i, (label, value, fmt) in enumerate(settings, start=3):
    day.cell(row=i, column=1, value=label).font = Font(bold=True)
    c = day.cell(row=i, column=2, value=value)
    c.fill = YOURS
    c.alignment = Alignment(horizontal='left')
    if fmt:
        c.number_format = fmt

# Frames behind the summary box (hidden column N).
day['N3'] = f'=SUM(N{FIRST}:N{LAST})'
day['N4'] = '=86400*B6'
day['N5'] = '=ABS(N4-N3)'
day['N6'] = '=MOD(ROUND(B5*86400,0)*B6+N3,N4)'
summary = [
    ('Scheduled', 'N3'),
    ('Day length', 'N4'),
    ('=IF(N3>N4,"Over by",IF(N3=N4,"Day is full","Left to fill"))', 'N5'),
    ('Day ends at', 'N6'),
]
for i, (label, cell) in enumerate(summary, start=3):
    day.cell(row=i, column=5, value=label).font = Font(bold=True)
    c = day.cell(row=i, column=6, value=f'={tc(cell)}')
    c.font = Font(name='Consolas', bold=True)

header(day, 8,
       ['#', 'Start', 'Planned start', 'Off by', 'Type', 'Title', 'Episode / version', 'House ID',
        'Duration (h:mm:ss)', '+ frames', 'Duration (TC)', 'Notes', '',
        'duration frames', 'start frames', 'time-of-day frames', 'clock hour', 'off-by frames'],
       [5, 13, 11, 20, 13, 32, 16, 12, 12, 8, 13, 28, 2, 10, 10, 10, 8, 10])

for r in range(FIRST, LAST + 1):
    day[f'A{r}'] = f'=IF(N{r}="","",COUNT(N${FIRST}:N{r}))'
    day[f'B{r}'] = f'=IF(P{r}="","",{tc(f"P{r}")})'
    day[f'D{r}'] = f'=IF(R{r}="","",IF(R{r}=0,"On time",IF(R{r}>0,"Late ","Early ")&{tc(f"ABS(R{r})")}))'
    day[f'K{r}'] = f'=IF(N{r}="","",{tc(f"N{r}")})'
    day[f'N{r}'] = f'=IF(AND(I{r}="",J{r}=""),"",ROUND(I{r}*86400,0)*$B$6+N(J{r}))'
    day[f'O{r}'] = f'=IF(N{r}="","",SUM(N${FIRST - 1}:N{r - 1}))'
    day[f'P{r}'] = f'=IF(N{r}="","",MOD(ROUND($B$5*86400,0)*$B$6+O{r},86400*$B$6))'
    day[f'Q{r}'] = f'=IF(P{r}="","",INT(P{r}/($B$6*3600)))'
    day[f'R{r}'] = f'=IF(OR(P{r}="",C{r}=""),"",MOD(P{r}-ROUND(MOD(C{r},1)*86400,0)*$B$6+43200*$B$6,86400*$B$6)-43200*$B$6)'
    for col in 'CEFGHIJL':
        day[f'{col}{r}'].fill = YOURS
    day[f'C{r}'].number_format = 'hh:mm:ss'
    day[f'I{r}'].number_format = '[h]:mm:ss'
    day[f'J{r}'].number_format = '0'
    for col in 'ABDK':
        day[f'{col}{r}'].font = Font(name='Consolas', color=INK)
    for col in 'ABCDEFGHIJKL':
        day[f'{col}{r}'].border = BOX

for r, item in enumerate(SAMPLE['items'], start=FIRST):
    if item.get('planned'):
        day[f'C{r}'] = seconds(item['planned']) / 86400
    day[f'E{r}'] = item['type']
    day[f'F{r}'] = item['title']
    day[f'G{r}'] = item.get('episode') or None
    day[f'H{r}'] = item.get('houseId') or None
    day[f'I{r}'] = seconds(item['duration']) / 86400
    day[f'J{r}'] = item.get('frames', 0)

for col in 'NOPQR':
    day.column_dimensions[col].hidden = True
day.freeze_panes = 'A9'

late = fill('FEF3C7')
day.conditional_formatting.add(f'D{FIRST}:D{LAST}', FormulaRule(formula=[f'AND(D{FIRST}<>"",D{FIRST}<>"On time")'], fill=late, font=Font(color='92400E', bold=True)))
day.conditional_formatting.add(f'D{FIRST}:D{LAST}', FormulaRule(formula=[f'D{FIRST}="On time"'], font=Font(color='15803D')))
day.conditional_formatting.add('E5:F5', FormulaRule(formula=['$N$3>$N$4'], fill=fill('FEE2E2'), font=Font(color='B91C1C', bold=True)))
day.conditional_formatting.add('E5:F5', FormulaRule(formula=['$N$3=$N$4'], fill=fill('DCFCE7'), font=Font(color='15803D', bold=True)))

# ------------------------------------------------------------------------------------------------
# Ad minutes
ads = wb.create_sheet('Ad minutes')
title(ads, 'Ad minutes per hour', 'From the Day playlist sheet: every item counts in the clock hour where it starts.')
ads['A3'] = 'Limit per hour (minutes)'
ads['A3'].font = Font(bold=True)
ads['B3'] = SAMPLE['adLimitMinutes']
ads['B3'].fill = YOURS
ads['B3'].alignment = Alignment(horizontal='left')
header(ads, 5, ['Hour', 'hour', 'Commercials', 'Promos', 'Sponsorship', 'Programmes', 'All items', 'Commercials against the limit'],
       [16, 5, 13, 11, 13, 12, 11, 30])
sumifs = f"SUMIFS({DAY}!$N${FIRST}:$N${LAST},{DAY}!$Q${FIRST}:$Q${LAST},$B{{r}}"
per = f"/{DAY}!$B$6/86400"
for r in range(6, 30):
    ads[f'A{r}'] = f'=TEXT(B{r},"00")&":00 – "&TEXT(MOD(B{r}+1,24),"00")&":00"'
    ads[f'B{r}'] = f'=MOD(INT(ROUND({DAY}!$B$5*86400,0)/3600)+ROW()-6,24)'
    for col, kind in zip('CDEF', ['Commercial', 'Promo', 'Sponsorship', 'Programme']):
        ads[f'{col}{r}'] = f'={sumifs.format(r=r)},{DAY}!$E${FIRST}:$E${LAST},"{kind}"){per}'
    ads[f'G{r}'] = f'={sumifs.format(r=r)}){per}'
    over = f'ROUND(C{r}*86400,0)-$B$3*60'
    ads[f'H{r}'] = f'=IF(G{r}=0,"",IF({over}>0,"Over by "&INT(({over})/60)&" min "&TEXT(MOD({over},60),"00")&" s","OK"))'
    for col in 'CDEFG':
        ads[f'{col}{r}'].number_format = '[h]:mm:ss'
    for col in 'ABCDEFGH':
        ads[f'{col}{r}'].border = BOX
ads['A30'] = 'Whole day'
ads['A30'].font = Font(bold=True)
for col in 'CDEFG':
    ads[f'{col}30'] = f'=SUM({col}6:{col}29)'
    ads[f'{col}30'].number_format = '[h]:mm:ss'
    ads[f'{col}30'].font = Font(bold=True)
ads.column_dimensions['B'].hidden = True
ads.freeze_panes = 'A6'
ads.conditional_formatting.add('H6:H29', FormulaRule(formula=['LEFT(H6,4)="Over"'], fill=fill('FEE2E2'), font=Font(color='B91C1C', bold=True)))
ads.conditional_formatting.add('H6:H29', FormulaRule(formula=['H6="OK"'], font=Font(color='15803D')))

# ------------------------------------------------------------------------------------------------
# Week grid
week = wb.create_sheet('Week grid')
title(week, 'Week grid', 'Half-hour slots from the day start on the Day playlist sheet. Titles that start with News, Kids, Series, Movie, Sport, Music or Magazine get a colour.')
header(week, 4, ['Time'] + SAMPLE['week']['days'], [8] + [22] * 7)
patterns = {'weekday': SAMPLE['week']['weekday'], 'weekend': SAMPLE['week']['weekend']}
for d, name in enumerate(SAMPLE['week']['days']):
    slots = [t for n, t in patterns['weekend' if name in ('Sat', 'Sun') else 'weekday'] for _ in range(n)]
    assert len(slots) == 48, name
    for i, text in enumerate(slots):
        week.cell(row=5 + i, column=2 + d, value=text)
for i in range(48):
    r = 5 + i
    week[f'A{r}'] = f'=TEXT(MOD({DAY}!$B$5+(ROW()-5)/48,1),"hh:mm")'
    week[f'A{r}'].font = Font(name='Consolas', color=GREY)
    for col in 'BCDEFGH':
        week[f'{col}{r}'].border = BOX
week.freeze_panes = 'B5'
colours = {'News': 'DBEAFE', 'Kids': 'FEF3C7', 'Series': 'DCFCE7', 'Movie': 'EDE9FE', 'Sport': 'FFEDD5', 'Music': 'FCE7F3', 'Magazine': 'CCFBF1'}
for word, colour in colours.items():
    week.conditional_formatting.add('B5:H52', FormulaRule(formula=[f'LEFT(B5,{len(word)})="{word}"'], fill=fill(colour)))

# ------------------------------------------------------------------------------------------------
# Lists (drop-down values)
lists = wb.create_sheet('Lists')
lists['A1'] = 'Type'
lists['C1'] = 'Frame rate'
for c in ('A1', 'C1'):
    lists[c].font = Font(bold=True)
for i, t in enumerate(SAMPLE['types'], start=2):
    lists[f'A{i}'] = t
for i, f in enumerate([24, 25, 30, 50, 60], start=2):
    lists[f'C{i}'] = f
lists.column_dimensions['A'].width = 16

# No "=" in front: the file keeps data-validation formulas without it, and Excel repairs files that have one.
types = DataValidation(type='list', formula1=f'Lists!$A$2:$A${len(SAMPLE["types"]) + 1}', allow_blank=True)
types.add(f'E{FIRST}:E{LAST}')
rates = DataValidation(type='list', formula1='Lists!$C$2:$C$6', allow_blank=False)
rates.add('B6')
frames = DataValidation(type='whole', operator='between', formula1='0', formula2='59', allow_blank=True,
                        error='Frames go from 0 to the frame rate minus one.', showErrorMessage=True)
frames.add(f'J{FIRST}:J{LAST}')
for v in (types, rates, frames):
    day.add_data_validation(v)

# ------------------------------------------------------------------------------------------------
for ws in (day, ads):
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
wb.properties.title = 'TV schedule template'
wb.properties.creator = '9eye'
wb.properties.subject = PAGE
wb.calculation.fullCalcOnLoad = True
wb.active = 0

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f'wrote {OUT.relative_to(SITE)} ({OUT.stat().st_size:,} bytes)')
