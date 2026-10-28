import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DateFilter,
  DateRange,
  MembershipMetric,
  PlayerSpending,
  TournamentMetric,
} from './organizerMetrics';

export type MetricsPdfScope = 'both' | 'tournaments' | 'memberships';

export type OrganizerMetricsPdfInput = {
  range: DateRange;
  dateFilter: DateFilter;
  scope?: MetricsPdfScope;
  summary: {
    totalRevenue: number;
    tournamentsRevenue: number;
    membershipsRevenue: number;
    tournamentCount: number;
    registrations: number;
    newPlayers: number;
  };
  membershipMetrics: MembershipMetric;
  tournamentMetrics: TournamentMetric[];
  playerSpending: PlayerSpending[];
  organizerName?: string | null;
};

function formatEuDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function periodLabel(filter: DateFilter, range: DateRange): string {
  switch (filter) {
    case 'today':
      return `Hoje (${formatEuDate(range.startDate)})`;
    case 'week':
      return `Ultima semana (${formatEuDate(range.startDate)} - ${formatEuDate(range.endDate)})`;
    case 'month':
      return `Este mes (${formatEuDate(range.startDate)} - ${formatEuDate(range.endDate)})`;
    case 'year':
      return `Este ano (${formatEuDate(range.startDate)} - ${formatEuDate(range.endDate)})`;
    case 'all':
      return 'Todo o historico';
    case 'custom':
      return `${formatEuDate(range.startDate)} - ${formatEuDate(range.endDate)}`;
    default:
      return `${formatEuDate(range.startDate)} - ${formatEuDate(range.endDate)}`;
  }
}

function euro(n: number): string {
  return `${n.toFixed(0)} EUR`;
}

function lastTableY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  return last?.finalY ?? fallback;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 16) {
    doc.addPage();
    return 18;
  }
  return y;
}

function scopeLabel(scope: MetricsPdfScope): string {
  switch (scope) {
    case 'tournaments':
      return 'Conteudo: so torneios';
    case 'memberships':
      return 'Conteudo: so memberships';
    default:
      return 'Conteudo: torneios e memberships';
  }
}

export async function exportOrganizerMetricsPDF(input: OrganizerMetricsPdfInput): Promise<void> {
  const {
    range,
    dateFilter,
    summary,
    membershipMetrics,
    tournamentMetrics,
    playerSpending,
    organizerName,
  } = input;
  const scope: MetricsPdfScope = input.scope ?? 'both';
  const includeTournaments = scope === 'both' || scope === 'tournaments';
  const includeMemberships = scope === 'both' || scope === 'memberships';

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relatorio de Metricas', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  if (organizerName) {
    doc.text(organizerName, pageWidth / 2, y, { align: 'center' });
    y += 6;
  }

  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`Periodo: ${periodLabel(dateFilter, range)}`, pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.text(scopeLabel(scope), pageWidth / 2, y, { align: 'center' });
  y += 10;
  doc.setTextColor(0, 0, 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Resumo do periodo', 14, y);
  y += 4;

  const uniquePlayers = playerSpending.length;
  const membersInSpending = playerSpending.filter(p => p.isMember).length;
  const paidAcrossTournaments = tournamentMetrics.reduce((s, t) => s + t.paidCount, 0);
  const memberRegs = tournamentMetrics.reduce((s, t) => s + t.memberRegistrations, 0);

  const summaryRevenue =
    scope === 'tournaments'
      ? summary.tournamentsRevenue
      : scope === 'memberships'
        ? summary.membershipsRevenue
        : summary.totalRevenue;

  const summaryBody: string[][] = [];
  summaryBody.push(['Receita (ambito)', euro(summaryRevenue), '', '']);
  if (includeTournaments) {
    summaryBody.push(
      ['Receita torneios', euro(summary.tournamentsRevenue), 'Torneios', String(summary.tournamentCount)],
      ['Inscricoes', String(summary.registrations), 'Novos jogadores', String(summary.newPlayers)],
      [
        'Inscricoes de membros',
        String(memberRegs),
        'Pagamentos (torneios)',
        String(paidAcrossTournaments),
      ],
      ['Jogadores unicos', String(uniquePlayers), 'Membros nos gastos', String(membersInSpending)]
    );
  }
  if (includeMemberships) {
    summaryBody.push(
      [
        'Receita memberships',
        euro(summary.membershipsRevenue),
        'Novos memberships',
        String(membershipMetrics.totalMembers),
      ],
      ['Membros activos (periodo)', String(membershipMetrics.activeMembers), '', '']
    );
  }

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2.5 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70 },
      1: { cellWidth: 40, halign: 'right' },
      2: { fontStyle: 'bold', cellWidth: 50 },
      3: { cellWidth: 30, halign: 'right' },
    },
    body: summaryBody,
    margin: { left: 14, right: 14 },
  });

  y = lastTableY(doc, y) + 12;

  if (includeTournaments) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    doc.text('Torneios', 14, y);
    y += 3;

    if (tournamentMetrics.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('Sem torneios neste periodo.', 14, y + 6);
      y += 14;
      doc.setTextColor(0, 0, 0);
    } else {
      const sorted = [...tournamentMetrics].sort((a, b) => b.startDate.localeCompare(a.startDate));
      autoTable(doc, {
        startY: y,
        head: [['Torneio', 'Data', 'Inscritos', 'Novos', 'Membros', 'Pagos', 'Receita']],
        body: sorted.map(t => [
          t.tournamentName,
          formatEuDate(t.startDate),
          String(t.registrations),
          String(t.newPlayers),
          String(t.memberRegistrations),
          String(t.paidCount),
          euro(t.revenue),
        ]),
        foot: [
          [
            'Total',
            '',
            String(summary.registrations),
            String(summary.newPlayers),
            String(memberRegs),
            String(paidAcrossTournaments),
            euro(summary.tournamentsRevenue),
          ],
        ],
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 8,
        },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 58 },
          1: { cellWidth: 24, halign: 'center' },
          2: { halign: 'right', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 16 },
          4: { halign: 'right', cellWidth: 18 },
          5: { halign: 'right', cellWidth: 16 },
          6: { halign: 'right', cellWidth: 22 },
        },
        margin: { left: 14, right: 14 },
      });
      y = lastTableY(doc, y) + 12;
    }
  }

  if (includeMemberships) {
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    doc.text('Memberships', 14, y);
    y += 3;

    if (membershipMetrics.plans.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('Sem memberships no periodo.', 14, y + 6);
      y += 14;
      doc.setTextColor(0, 0, 0);
    } else {
      autoTable(doc, {
        startY: y,
        head: [['Plano', 'Qtd.', 'Receita']],
        body: membershipMetrics.plans.map(p => [p.name, String(p.count), euro(p.revenue)]),
        foot: [['Total', String(membershipMetrics.totalMembers), euro(membershipMetrics.totalRevenue)]],
        theme: 'striped',
        headStyles: { fillColor: [124, 58, 237], fontSize: 9, fontStyle: 'bold' },
        footStyles: {
          fillColor: [245, 243, 255],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 100 },
          1: { cellWidth: 30, halign: 'right' },
          2: { cellWidth: 40, halign: 'right' },
        },
        margin: { left: 14, right: 14 },
      });
      y = lastTableY(doc, y) + 12;
    }
  }

  // Gastos: só torneios / só memb. / ambos — filtra linhas e colunas
  const spendingForScope =
    scope === 'tournaments'
      ? playerSpending.filter(p => p.tournamentSpent > 0 || p.tournamentCount > 0)
      : scope === 'memberships'
        ? playerSpending.filter(p => p.membershipSpent > 0)
        : playerSpending;

  y = ensureSpace(doc, y, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text(
    scope === 'memberships'
      ? 'Gastos memberships por jogador'
      : scope === 'tournaments'
        ? 'Gastos em torneios por jogador'
        : 'Gastos por jogador',
    14,
    y
  );
  y += 3;

  if (spendingForScope.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('Sem gastos de jogadores no periodo.', 14, y + 6);
  } else {
    const amountKey =
      scope === 'tournaments'
        ? (p: PlayerSpending) => p.tournamentSpent
        : scope === 'memberships'
          ? (p: PlayerSpending) => p.membershipSpent
          : (p: PlayerSpending) => p.totalSpent;
    const sortedSpend = [...spendingForScope].sort((a, b) => amountKey(b) - amountKey(a));
    const shown = sortedSpend.slice(0, 80);

    if (scope === 'tournaments') {
      autoTable(doc, {
        startY: y,
        head: [['Jogador', 'Tel.', 'Torneios', 'EUR Torneios', 'Tipo']],
        body: shown.map(p => [
          p.playerName,
          p.playerPhone || '-',
          String(p.tournamentCount),
          euro(p.tournamentSpent),
          p.isMember ? 'Membro' : 'Jogador',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 60 },
          1: { cellWidth: 35 },
          2: { cellWidth: 22, halign: 'right' },
          3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
          4: { cellWidth: 25 },
        },
        margin: { left: 14, right: 14 },
      });
    } else if (scope === 'memberships') {
      autoTable(doc, {
        startY: y,
        head: [['Jogador', 'Tel.', 'EUR Memberships']],
        body: shown.map(p => [p.playerName, p.playerPhone || '-', euro(p.membershipSpent)]),
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 40 },
          2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 14, right: 14 },
      });
    } else {
      autoTable(doc, {
        startY: y,
        head: [['Jogador', 'Tel.', 'Torneios', 'EUR Torneios', 'EUR Memb.', 'Total', 'Tipo']],
        body: shown.map(p => [
          p.playerName,
          p.playerPhone || '-',
          String(p.tournamentCount),
          euro(p.tournamentSpent),
          euro(p.membershipSpent),
          euro(p.totalSpent),
          p.isMember ? 'Membro' : 'Jogador',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [15, 118, 110], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 42 },
          1: { cellWidth: 28 },
          2: { cellWidth: 16, halign: 'right' },
          3: { cellWidth: 24, halign: 'right' },
          4: { cellWidth: 22, halign: 'right' },
          5: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
          6: { cellWidth: 20 },
        },
        margin: { left: 14, right: 14 },
      });
    }
    y = lastTableY(doc, y) + 6;

    if (sortedSpend.length > shown.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(
        `A mostrar os ${shown.length} jogadores com maior gasto (de ${sortedSpend.length}).`,
        14,
        y + 4
      );
    }
  }

  const pageCount = doc.getNumberOfPages();
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Gerado em ${stamp}`, 14, doc.internal.pageSize.getHeight() - 8);
    doc.text(`Pag. ${i}/${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, {
      align: 'right',
    });
  }

  const scopeSuffix =
    scope === 'tournaments' ? 'torneios' : scope === 'memberships' ? 'memberships' : 'completo';
  const fileSafePeriod = `${range.startDate}_${range.endDate}`.replace(/[^\d_-]/g, '');
  doc.save(`metricas_${scopeSuffix}_${fileSafePeriod}.pdf`);
}
