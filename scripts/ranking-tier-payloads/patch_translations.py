#!/usr/bin/env python3
"""Insert rankingTier* translation keys into src/lib/translations.ts"""
from pathlib import Path

path = Path("src/lib/translations.ts")
text = path.read_text()
if "rankingTierTitle" in text:
    print("translations already have rankingTier keys")
    raise SystemExit(0)

inserts = [
    ("      formatHelper: 'Choose the tournament format. This determines how players/teams are organized.',", "      rankingTierTitle: '12\u2011month ranking points',\n      rankingTierHelper: 'Choose the points scale for this tournament in the rolling ranking.',\n      rankingTierMaster: 'Master',\n      rankingTierOpen: 'Open',\n      rankingTierAmericano: 'American',\n      rankingTierMasterHint: '1st 1000 \u00b7 2nd 600 \u00b7 3rd/4th 360',\n      rankingTierOpenHint: '1st 500 \u00b7 2nd 300 \u00b7 3rd/4th 180',\n      rankingTierAmericanoHint: '1st 250 \u00b7 2nd 150 \u00b7 3rd/4th 90',\n"),
    ("      formatHelper: 'Escolha o formato do torneio. Isto determina como os jogadores/equipas s\u00e3o organizados.',", "      rankingTierTitle: 'Pontos do Ranking 12 Meses',\n      rankingTierHelper: 'Escolhe a escala de pontos deste torneio no ranking deslizante.',\n      rankingTierMaster: 'Master',\n      rankingTierOpen: 'Open',\n      rankingTierAmericano: 'Americano',\n      rankingTierMasterHint: '1\u00ba 1000 \u00b7 2\u00ba 600 \u00b7 3\u00ba/4\u00ba 360',\n      rankingTierOpenHint: '1\u00ba 500 \u00b7 2\u00ba 300 \u00b7 3\u00ba/4\u00ba 180',\n      rankingTierAmericanoHint: '1\u00ba 250 \u00b7 2\u00ba 150 \u00b7 3\u00ba/4\u00ba 90',\n"),
    ("      formatHelper: 'Elige el formato del torneo. Esto determina c\u00f3mo se organizan los jugadores/equipos.',", "      rankingTierTitle: 'Puntos del Ranking 12 Meses',\n      rankingTierHelper: 'Elige la escala de puntos de este torneo en el ranking deslizante.',\n      rankingTierMaster: 'Master',\n      rankingTierOpen: 'Open',\n      rankingTierAmericano: 'Americano',\n      rankingTierMasterHint: '1\u00ba 1000 \u00b7 2\u00ba 600 \u00b7 3\u00ba/4\u00ba 360',\n      rankingTierOpenHint: '1\u00ba 500 \u00b7 2\u00ba 300 \u00b7 3\u00ba/4\u00ba 180',\n      rankingTierAmericanoHint: '1\u00ba 250 \u00b7 2\u00ba 150 \u00b7 3\u00ba/4\u00ba 90',\n"),
    ("      formatHelper: 'Choisissez le format du tournoi. Cela d\u00e9termine comment les joueurs/\u00e9quipes sont organis\u00e9s.',", "      rankingTierTitle: 'Points du classement 12 mois',\n      rankingTierHelper: 'Choisissez l\u2019\u00e9chelle de points de ce tournoi dans le classement glissant.',\n      rankingTierMaster: 'Master',\n      rankingTierOpen: 'Open',\n      rankingTierAmericano: 'Am\u00e9ricain',\n      rankingTierMasterHint: '1er 1000 \u00b7 2e 600 \u00b7 3e/4e 360',\n      rankingTierOpenHint: '1er 500 \u00b7 2e 300 \u00b7 3e/4e 180',\n      rankingTierAmericanoHint: '1er 250 \u00b7 2e 150 \u00b7 3e/4e 90',\n"),
    ("      formatHelper: 'Scegli il formato del torneo. Questo determina come i giocatori/squadre sono organizzati.',", "      rankingTierTitle: 'Punti ranking 12 mesi',\n      rankingTierHelper: 'Scegli la scala di punti di questo torneo nel ranking scorrevole.',\n      rankingTierMaster: 'Master',\n      rankingTierOpen: 'Open',\n      rankingTierAmericano: 'Americano',\n      rankingTierMasterHint: '1\u00ba 1000 \u00b7 2\u00ba 600 \u00b7 3\u00ba/4\u00ba 360',\n      rankingTierOpenHint: '1\u00ba 500 \u00b7 2\u00ba 300 \u00b7 3\u00ba/4\u00ba 180',\n      rankingTierAmericanoHint: '1\u00ba 250 \u00b7 2\u00ba 150 \u00b7 3\u00ba/4\u00ba 90',\n"),
]

for anchor, block in inserts:
    if anchor not in text:
        raise SystemExit(f"anchor not found: {anchor!r}")
    idx = text.find(anchor)
    end = text.find("\n", idx)
    if end < 0:
        raise SystemExit("no newline after anchor")
    window = text[end:end+400]
    if "rankingTierTitle" in window:
        continue
    text = text[:end+1] + block + text[end+1:]
    print("inserted after", anchor[:60])

path.write_text(text)
print("wrote", path, len(text))
