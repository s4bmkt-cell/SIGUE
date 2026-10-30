# -*- coding: utf-8 -*-
"""SIGUE — Guía de Uso Rápida (cuerpo PDF, sin portada)."""
import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    CondPageBreak, KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Paleta (pdf.py palette.generate) ──
ACCENT       = colors.HexColor('#308cab')
TEXT_PRIMARY  = colors.HexColor('#22221f')
TEXT_MUTED    = colors.HexColor('#7e7b72')
BG_SURFACE    = colors.HexColor('#e4e1d8')
BG_PAGE       = colors.HexColor('#f4f4f2')
TABLE_HEADER_COLOR = ACCENT
TABLE_ROW_ODD      = colors.HexColor('#edf4f7')

# ── Fuentes (Windows) ──
WIN_FONTS = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts')
pdfmetrics.registerFont(TTFont('TimesNewRoman', os.path.join(WIN_FONTS, 'times.ttf')))
pdfmetrics.registerFont(TTFont('TimesNewRoman-Bold', os.path.join(WIN_FONTS, 'timesbd.ttf')))
pdfmetrics.registerFont(TTFont('TimesNewRoman-Italic', os.path.join(WIN_FONTS, 'timesi.ttf')))
registerFontFamily('TimesNewRoman', normal='TimesNewRoman', bold='TimesNewRoman-Bold', italic='TimesNewRoman-Italic')

# ── Estilos ──
h1 = ParagraphStyle('H1', fontName='TimesNewRoman-Bold', fontSize=16, leading=20,
                    textColor=ACCENT, spaceBefore=16, spaceAfter=6)
h2 = ParagraphStyle('H2', fontName='TimesNewRoman-Bold', fontSize=12.5, leading=16,
                    textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=4)
body = ParagraphStyle('Body', fontName='TimesNewRoman', fontSize=10.5, leading=15.5,
                      textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceAfter=6)
bullet = ParagraphStyle('Bullet', parent=body, leftIndent=14, bulletIndent=2, spaceAfter=3)
cell = ParagraphStyle('Cell', fontName='TimesNewRoman', fontSize=9.5, leading=13, textColor=TEXT_PRIMARY)
cell_b = ParagraphStyle('CellB', fontName='TimesNewRoman-Bold', fontSize=9.5, leading=13,
                        textColor=colors.white, alignment=TA_CENTER)
cell_c = ParagraphStyle('CellC', fontName='TimesNewRoman', fontSize=9.5, leading=13,
                        textColor=TEXT_PRIMARY, alignment=TA_CENTER)
caption = ParagraphStyle('Caption', fontName='TimesNewRoman-Italic', fontSize=8.5, leading=11,
                         textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=10)

A4_W, A4_H = A4
LEFT = RIGHT = 1.9 * cm
TOP = BOTTOM = 1.9 * cm
AVAIL = A4_W - LEFT - RIGHT
H1_ORPHAN = (A4_H - TOP - BOTTOM) * 0.15

def sect(title):
    return [CondPageBreak(H1_ORPHAN), Paragraph('<b>%s</b>' % title, h1)]

def make_table(rows, col_ratios, widths=None):
    if widths is None:
        widths = [r * AVAIL for r in col_ratios]
    t = Table(rows, colWidths=widths, hAlign='CENTER')
    return t

def header_row(cells):
    return [Paragraph('<b>%s</b>' % c, cell_b) for c in cells]

def cell_row(cells, center=False):
    st = cell_c if center else cell
    return [Paragraph(c, st) for c in cells]

story = []

# ===== Portada (no va en body; se inserta después) =====

# ===== 1. Introducción =====
story += sect('1.  Introducción')
story.append(Paragraph(
    'SIGUE es una plataforma SaaS que ayuda a las organizaciones a implementar, operar, mantener y '
    'preparar la certificación de sistemas de gestión ISO de forma integrada y digital. Cubre el ciclo '
    'completo de gestión: planificar, implementar, verificar y mejorar (ciclo PDCA).', body))
story.append(Paragraph(
    'La plataforma incluye cuatro normas en su versión actual, un núcleo común de gestión documental y de '
    'mejora, y una capa transversal de inteligencia artificial que asiste a las personas sin sustituir su '
    'responsabilidad.', body))
t = make_table([
    header_row(['Norma', 'Alcance', 'Módulos particulares']),
    cell_row(['ISO 9001', 'Calidad', 'Satisfacción del cliente, control de producción, no conformidades']),
    cell_row(['ISO/IEC 27001', 'Seguridad de la información', 'Inventario de activos, Declaración de Aplicabilidad (SOA), incidentes']),
    cell_row(['ISO 22301', 'Continuidad del negocio', 'BIA con RTO/RPO, planes de continuidad, ejercicios']),
    cell_row(['ISO/IEC 42001', 'Gestión de la IA', 'Inventario de sistemas de IA, casos de uso, evaluaciones de impacto, riesgos']),
], [0.16, 0.22, 0.62])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), TABLE_HEADER_COLOR),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_ROW_ODD]),
    ('GRID', (0,0), (-1,-1), 0.5, TEXT_MUTED),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 7), ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(t)
story.append(Paragraph('Tabla 1. Normas disponibles en SIGUE', caption))

# ===== 2. Acceso e inicio de sesión =====
story += sect('2.  Acceso e inicio de sesión')
story.append(Paragraph('La plataforma se ejecuta localmente en el puerto 3000 (web) y 3001 (API).', body))
t = make_table([
    header_row(['Recurso', 'Dirección', 'Uso']),
    cell_row(['Aplicación web', 'http://localhost:3000', 'Interfaz principal de SIGUE']),
    cell_row(['Documentación API (Swagger)', 'http://localhost:3001/docs', 'Prueba interactiva de los servicios']),
    cell_row(['Estado de la API', 'http://localhost:3001/api/v1/health', 'Verifica que el backend responde']),
], [0.30, 0.34, 0.36])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), TABLE_HEADER_COLOR),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_ROW_ODD]),
    ('GRID', (0,0), (-1,-1), 0.5, TEXT_MUTED),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 7), ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(t)
story.append(Paragraph('Tabla 2. Direcciones de acceso', caption))
story.append(Paragraph('Usuarios de demostración (contraseña: demo-password):', body))
t = make_table([
    header_row(['Usuario', 'Rol', 'Qué permite ver']),
    cell_row(['mariana.torres@org.mx', 'Responsable del SGI', 'Todos los módulos y normas']),
    cell_row(['consultora@demo.mx', 'Consultor externo', 'Consola consultor: sus clientes y avances']),
    cell_row(['jorge.aldana@org.mx', 'Administrador de organización', 'Administración de la organización']),
], [0.34, 0.28, 0.38])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), TABLE_HEADER_COLOR),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_ROW_ODD]),
    ('GRID', (0,0), (-1,-1), 0.5, TEXT_MUTED),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 7), ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(t)
story.append(Paragraph('Tabla 3. Credenciales de demostración', caption))
story.append(Paragraph(
    'Al iniciar sesión se solicita la autenticación de dos factores (MFA). En el entorno de demostración, '
    'el MFA se puede configurar desde el perfil; los usuarios seed inician sesión directamente.', body))

# ===== 3. Estructura de la plataforma =====
story += sect('3.  Estructura de la plataforma')
story.append(Paragraph('El menú lateral organiza la plataforma en tres grupos:', body))
story += [
    Paragraph('•  <b>Operación:</b> Inicio, Normas y requisitos, Diagnóstico inicial, Contexto, Planificación, Documentos, Plantillas, Evidencias, ISO 27001, ISO 22301 e ISO 42001.', bullet),
    Paragraph('•  <b>Verificar y mejorar:</b> Auditorías, No conformidades, Revisión por la dirección y Tableros.', bullet),
    Paragraph('•  <b>Configuración:</b> Gobernanza de IA, Suscripción y Notificaciones.', bullet),
]
story.append(Paragraph(
    'El botón flotante «Asistente SIGUE» (abajo a la derecha) está disponible en todas las pantallas: es el '
    'copiloto de IA contextual.', body))

# ===== 4. Flujo principal (ciclo PDCA) =====
story += sect('4.  Flujo principal: ciclo PDCA (ISO 9001)')
story.append(Paragraph('El recorrido recomendado para implementar el sistema de gestión es:', body))
flow = make_table([
    header_row(['Etapa', 'Módulo', 'Acción principal']),
    cell_row(['1. Planificar', 'Diagnóstico inicial', 'Ejecutar el diagnóstico y generar el plan automático de implementación']),
    cell_row(['2. Contexto', 'Contexto de la organización', 'Registrar FODA, partes interesadas, requisitos legales y mapa de procesos']),
    cell_row(['3. Planificar', 'Planificación', 'Identificar riesgos y oportunidades, definir objetivos y planes de trabajo']),
    cell_row(['4. Implementar', 'Documentos y evidencias', 'Elaborar la información documentada y cargar evidencias por requisito']),
    cell_row(['5. Verificar', 'Auditorías', 'Programar auditorías internas, registrar hallazgos y generar el informe']),
    cell_row(['6. Mejorar', 'No conformidades', 'Registrar NC, analizar causa raíz, implementar acciones y verificar eficacia']),
    cell_row(['7. Revisar', 'Revisión por la dirección', 'Revisar entradas automáticas, acordar decisiones y dar seguimiento']),
], [0.20, 0.26, 0.54])
flow.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), TABLE_HEADER_COLOR),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_ROW_ODD]),
    ('GRID', (0,0), (-1,-1), 0.5, TEXT_MUTED),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 7), ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(flow)
story.append(Paragraph('Tabla 4. Recorrido recomendado del sistema de gestión', caption))

# ===== 5. Normas especializadas =====
story += sect('5.  Normas especializadas')
story.append(Paragraph('<b>ISO/IEC 27001 — Seguridad de la información.</b> Gestiona el inventario de activos, '
    'la Declaración de Aplicabilidad (SOA) del Anexo A (editable control por control) y los incidentes de seguridad.', body))
story.append(Paragraph('<b>ISO 22301 — Continuidad del negocio.</b> Documenta el análisis de impacto (BIA) con RTO y RPO, '
    'los planes de continuidad con su estrategia y las pruebas y ejercicios programados.', body))
story.append(Paragraph('<b>ISO/IEC 42001 — Gestión de la IA.</b> Mantiene el inventario de sistemas de IA, sus casos de uso '
    'con nivel de supervisión humana, las evaluaciones de impacto, los riesgos con controles del Anexo A y el ciclo de '
    'vida de cada sistema.', body))

# ===== 6. Capa transversal de IA =====
story += sect('6.  Capa transversal de IA')
story.append(Paragraph('La plataforma integra una capa de IA transversal, segura y gobernada:', body))
story += [
    Paragraph('•  <b>Copiloto contextual:</b> desde el botón flotante, sugiere acciones según la pantalla (preparar borradores, resumir, sugerir riesgos, buscar inconsistencias, proponer causa raíz, clasificar evidencias).', bullet),
    Paragraph('•  <b>Supervisión humana:</b> toda salida es un borrador etiquetado como IA, con sus fuentes; puedes aceptar, editar, rechazar o reportar.', bullet),
    Paragraph('•  <b>Gobernanza:</b> en «Gobernanza de IA» se administran los casos de uso (cuotas y desactivación), la búsqueda semántica, la bitácora de interacciones y los incidentes.', bullet),
]

# ===== 7. Firma electrónica y plantillas =====
story += sect('7.  Firma electrónica y plantillas')
story.append(Paragraph('<b>Firma electrónica.</b> Al publicar un documento, el sistema genera una firma de aprobación '
    '(hash del contenido + identidad + timestamp). Los colaboradores pueden «Firmar / Aceptar» los documentos publicados. '
    'Las firmas se listan por documento y su integridad puede verificarse.', body))
story.append(Paragraph('<b>Plantillas.</b> El módulo Plantillas incluye un paquete de contenido propietario: políticas, '
    'procedimientos, formatos y registros por norma. «Crear documento» genera un borrador con el contenido de la plantilla.', body))

# ===== 8. Consola consultor y suscripción =====
story += sect('8.  Consola consultor y suscripción')
story.append(Paragraph('<b>Consola consultor.</b> El rol de consultor externo con varias organizaciones asignadas ve '
    '«Consola Consultor»: lista de clientes con su salud (bueno, en observación, crítico), cumplimiento, NC y tareas, '
    'más un consolidado global.', body))
story.append(Paragraph('<b>Suscripción.</b> El módulo muestra el plan, las cuotas de uso (usuarios, almacenamiento, normas '
    'y tokens de IA) con barras de consumo, el catálogo de planes y la exportación completa de la información de la '
    'organización (portabilidad de datos).', body))

# ===== 9. Cómo arrancar =====
story += sect('9.  Cómo arrancar el proyecto')
code_style = ParagraphStyle('Code', fontName='TimesNewRoman', fontSize=9.5, leading=13.5,
                            textColor=TEXT_PRIMARY, leftIndent=8)
code_block = Table([[Paragraph('cd "C:\\Users\\rsola\\OneDrive\\Documentos\\Sistema Gobernanza Normativa\\sigue"<br/>npm run dev', code_style)]],
                   colWidths=[AVAIL], hAlign='CENTER')
code_block.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), BG_PAGE),
    ('BOX', (0,0), (-1,-1), 0.6, ACCENT),
    ('LEFTPADDING', (0,0), (-1,-1), 10), ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8),
]))
story.append(code_block)
story.append(Spacer(1, 10))
story.append(Paragraph(
    'El comando <b>npm run dev</b> levanta la API en el puerto 3001 y la aplicación web en el 3000. Los datos de '
    'demostración viven en PostgreSQL (base «sigue»); para restablecerlos con el estado inicial se ejecuta '
    '<b>npx prisma migrate reset --force</b> dentro de apps/api.', body))

# Pie de página con numeración
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate
class NumberedDoc(BaseDocTemplate):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        frame = Frame(LEFT, BOTTOM, A4_W - LEFT - RIGHT, A4_H - TOP - BOTTOM, id='main')
        self.addPageTemplates([PageTemplate(id='page', frames=[frame], onPage=self.footer)])
    def footer(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(ACCENT)
        canvas.setLineWidth(0.6)
        canvas.line(LEFT, 1.25*cm, A4_W - RIGHT, 1.25*cm)
        canvas.setFont('TimesNewRoman', 8)
        canvas.setFillColor(TEXT_MUTED)
        canvas.drawString(LEFT, 1.0*cm, 'SIGUE - Guía de uso rápida')
        canvas.drawRightString(A4_W - RIGHT, 1.0*cm, 'Página %d' % canvas.getPageNumber())
        canvas.restoreState()

doc = NumberedDoc('guia_cuerpo.pdf', pagesize=A4,
                  leftMargin=LEFT, rightMargin=RIGHT, topMargin=TOP, bottomMargin=BOTTOM,
                  title='SIGUE - Guia de Uso Rapida', author='SIGUE', creator='SIGUE',
                  subject='Guia de uso rapida de la plataforma SIGUE')
doc.build(story)
print('body OK')
