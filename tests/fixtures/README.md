# Result fixtures

Captured on 2026-10-18 from public SELAE and RTVE responses. The HTML fixtures retain the relevant result/article sections; no account or participant data is included.

- `selae-2026-05-05.json`: https://www.loteriasyapuestas.es/servicios/buscadorSorteos?game_id=EMIL&celebrados=true&fechaInicioInclusiva=20260505&fechaFinInclusiva=20260505
- `selae-2026-10-16.json`: the same endpoint, date range `20261016`.
- `selae-2026-05-05.html`: https://www.loteriasyapuestas.es/es/euromillones/escrutinios/euromillones-premios-y-ganadores-del-05-de-mayo-de-2026
- `rtve-2026-10-16.html`: result block from https://www.rtve.es/loterias/euromillones/
- `rtve-2026-05-05-article.html`: https://www.rtve.es/rtve/20260506/sorteo-bonoloto-euromillones-del-martes-5-mayo/17054400.shtml

The RTVE widget displays 3.00 EUR for category 13 on 2026-10-16, whereas SELAE publishes 3.67 EUR. RTVE amounts are deliberately excluded from automatic accounting. SELAE's article template uses `131.785.52` while the JSON uses `131785,52`; the fixture ensures both parse to 131785.52 EUR.

Additional public factual result sections captured on 2026-10-18:

- `angelita-2026-05-05.html`: https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-5-mayo
- `angelita-2026-10-13.html`: https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-13-octubre
- `angelita-2026-10-16.html`: https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-16-octubre
- `comprobar-2026-05-05.html`: https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-05-05
- `comprobar-2026-10-13.html`: https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-10-13
- `comprobar-2026-10-16.html`: https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-10-16

Only dated headings, combinations and the Spanish payout tables are retained. The two publications agree on every category for these three dates. The 05 May and 16 October tables also match the SELAE JSON fixtures. A missing category, duplicate, mismatched combination or one-cent discrepancy prevents verification of the pair. Foreign-country tables from ComprobarEuromillones are not used.

Publisher checks: https://www.loteriaangelita.com/legal identifies Lotería Angelita S.L. The disclaimer at https://www.comprobareuromillones.com/aviso_legal.php describes an information portal unaffiliated with SELAE but does not identify its corporate owner. Therefore the product describes two publications, not proven corporate independence or direct official verification.

The RTVE article https://www.rtve.es/rtve/20261014/sorteo-bonoloto-euromillones-del-martes-13-octubre/17263973.shtml was also inspected: it lists six main numbers and an outdated payout table (category 13: 4.38 EUR instead of 4.02 EUR). This reinforces excluding RTVE amounts even when an article includes cents.
