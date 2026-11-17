import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanySettings } from '../types/index.ts';
import { formatCurrency, formatDisplayDate } from './format.ts';
import { trimLogoWhitespace } from './logoTrim.ts';

export type PaperOrientation = 'portrait' | 'landscape';

export interface PdfMetadataPair {
  label: string;
  value: string;
}

export interface PdfProjectInfoRow {
  field: string;
  details: string;
}

export interface PdfSummaryRow {
  label: string;
  value: string;
  highlight?: 'navy' | 'positive' | 'negative' | 'muted';
}

export interface PdfExportOptions {
  filename: string;
  company: CompanySettings;
  documentTitle: string;
  subtitle?: string;
  documentDate: string;
  preparedBy: string;
  orientation?: PaperOrientation;
  projectInfo?: PdfProjectInfoRow[];
  metadata?: PdfMetadataPair[];
  columns: string[];
  rows: Array<Array<string | number>>;
  columnAlignments?: Record<number, 'left' | 'center' | 'right'>;
  summaryRows?: PdfSummaryRow[];
  note?: string;
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportA4Pdf(options: PdfExportOptions): Promise<void> {
  const orientation: PaperOrientation = options.orientation || 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = 12;

  // Top Header Band
  const rawLogoData = await loadImageAsDataUrl(options.company.logo_url);
  const logoData = rawLogoData ? await trimLogoWhitespace(rawLogoData) : null;
  if (logoData) {
    try {
      const format = logoData.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logoData, format, margin, y, 20, 20);
    } catch {
      // Fallback gracefully if image bytes cannot be decoded
    }
  }

  const textLeft = logoData ? margin + 23.5 : margin;
  const leftMaxWidth = pageWidth - margin - textLeft - 56;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 35, 66); // #0F2342 Navy
  doc.text(options.company.company_name || 'A-MIISAAN CONSTRUCTION CO.', textLeft, y + 5.5, { maxWidth: leftMaxWidth });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const contactLine = [options.company.address, options.company.phone, options.company.email]
    .filter(Boolean)
    .join('  |  ');
  doc.text(contactLine, textLeft, y + 11, { maxWidth: leftMaxWidth });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 134, 215); // #0086D7 Logo Blue
  doc.text(options.documentTitle.toUpperCase(), textLeft, y + 17, { maxWidth: leftMaxWidth });

  // Right header metadata (compact, right-aligned, no exchange rate)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Date: ${formatDisplayDate(options.documentDate)}`, pageWidth - margin, y + 5.5, { align: 'right' });
  doc.text('Currency: USD ($)', pageWidth - margin, y + 11, { align: 'right' });
  doc.text(`Prepared By: ${options.preparedBy}`, pageWidth - margin, y + 16.5, { align: 'right' });

  y += 23;
  doc.setDrawColor(15, 35, 66);
  doc.setLineWidth(0.55);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  if (options.subtitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(options.subtitle, margin, y);
    y += 4.5;
  }

  // Structured Single-Project Information Table (Field | Details)
  if (options.projectInfo && options.projectInfo.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 35, 66);
    doc.text('PROJECT INFORMATION', margin, y + 1.5);
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Field', 'Details']],
      body: options.projectInfo.map((row) => [row.field, row.details]),
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: { top: 1.5, right: 2.5, bottom: 1.5, left: 2.5 },
        textColor: [15, 23, 42],
        lineColor: [203, 213, 225],
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 35, 66],
        fontStyle: 'bold',
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 46, fontStyle: 'bold', textColor: [71, 85, 105] },
        1: { cellWidth: 'auto', textColor: [15, 23, 42] },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y + 36) + 4;
  }

  // Filter / Report Scope Metadata Strip (includes Expense Count prominently at top)
  if (options.metadata && options.metadata.length > 0) {
    const colsPerRow = orientation === 'landscape' ? 4 : 2;
    const boxRows = Math.ceil(options.metadata.length / colsPerRow);
    const rowStep = 5.5;
    const boxHeight = boxRows * rowStep + 3.5;

    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, pageWidth - margin * 2, boxHeight, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, pageWidth - margin * 2, boxHeight, 'S');

    const colWidth = (pageWidth - margin * 2 - 6) / colsPerRow;
    options.metadata.forEach((pair, index) => {
      const col = index % colsPerRow;
      const row = Math.floor(index / colsPerRow);
      const px = margin + 3 + col * colWidth;
      const py = y + 4.8 + row * rowStep;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      const labelStr = `${pair.label}:`;
      doc.text(labelStr, px, py);

      const labelWidth = doc.getTextWidth(labelStr);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(String(pair.value || '—'), px + labelWidth + 2, py, { maxWidth: colWidth - labelWidth - 4 });
    });

    y += boxHeight + 4;
  }

  // Main Data Table (fit strictly inside A4 width without clipping)
  const colStyles: Record<number, { halign?: 'left' | 'center' | 'right' }> = {};
  if (options.columnAlignments) {
    Object.entries(options.columnAlignments).forEach(([idx, align]) => {
      colStyles[Number(idx)] = { halign: align };
    });
  }

  const colCount = options.columns.length;
  const tableFontSize =
    orientation === 'landscape'
      ? colCount >= 9
        ? 8
        : 8.5
      : colCount >= 8
      ? 7.2
      : colCount >= 6
      ? 7.8
      : 8.2;
  const cellPad = orientation === 'landscape' ? 2.2 : colCount >= 8 ? 1.7 : 2.1;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 26 },
    tableWidth: 'auto',
    head: [options.columns],
    body:
      options.rows.length > 0
        ? options.rows
        : [['No records found for selected criteria', ...options.columns.slice(1).map(() => '')]],
    styles: {
      font: 'helvetica',
      fontSize: tableFontSize,
      cellPadding: { top: cellPad, right: cellPad, bottom: cellPad, left: cellPad },
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 35, 66],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: tableFontSize,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: colStyles,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;
  let summaryY = finalY;

  if (summaryY > pageHeight - 52) {
    doc.addPage();
    summaryY = 16;
  }

  // Financial Summary Box (strictly monetary totals)
  if (options.summaryRows && options.summaryRows.length > 0) {
    const boxWidth = 88;
    const boxX = pageWidth - margin - boxWidth;
    const rowH = 5.8;
    const boxH = options.summaryRows.length * rowH + 5;

    doc.setFillColor(248, 250, 252);
    doc.rect(boxX, summaryY, boxWidth, boxH, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(boxX, summaryY, boxWidth, boxH, 'S');

    options.summaryRows.forEach((item, idx) => {
      const ry = summaryY + 5 + idx * rowH;
      doc.setFont('helvetica', item.highlight === 'navy' ? 'bold' : 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(item.label, boxX + 3, ry);

      doc.setFont('helvetica', 'bold');
      if (item.highlight === 'positive') doc.setTextColor(21, 128, 61);
      else if (item.highlight === 'negative') doc.setTextColor(185, 28, 28);
      else if (item.highlight === 'navy') doc.setTextColor(15, 35, 66);
      else doc.setTextColor(15, 23, 42);

      doc.text(item.value, boxX + boxWidth - 3, ry, { align: 'right' });
    });

    summaryY += boxH + 6;
  }

  if (options.note) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const wrapped = doc.splitTextToSize(options.note, pageWidth - margin * 2);
    doc.text(wrapped, margin, summaryY);
    summaryY += wrapped.length * 3.8 + 5;
  }

  // Signature block
  if (summaryY > pageHeight - 32) {
    doc.addPage();
    summaryY = pageHeight - 34;
  } else {
    summaryY = Math.max(summaryY + 4, pageHeight - 34);
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, summaryY, margin + 58, summaryY);
  doc.line(pageWidth - margin - 58, summaryY, pageWidth - margin, summaryY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`Prepared By: ${options.preparedBy}`, margin, summaryY + 4);
  doc.text(options.company.signature_name || 'Authorized Signatory', pageWidth - margin, summaryY + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text('Accountant / Finance Office', margin, summaryY + 7.8);
  doc.text(options.company.signature_title || 'Authorized Signature', pageWidth - margin, summaryY + 7.8, { align: 'right' });

  // Page numbers & Company Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      options.company.footer_text || `${options.company.company_name} — Official Financial Record`,
      margin,
      pageHeight - 8.5
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 8.5, { align: 'right' });
  }

  doc.save(options.filename);
}

export { formatCurrency, formatDisplayDate };
