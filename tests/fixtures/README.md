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

## Whole-euro amounts and missing archive entries

Additional factual sections captured on 2026-10-18. ComprobarEuromillones omits `,00` for whole-euro payouts, including category 8 at `14 €` (6 February), category 7 at `56 €` (17 April), category 5 at `145 €` (26 May), and jackpots. Angelita explicitly includes two decimals. Only Comprobar accepts this documented whole-euro format; automatic payouts still require all thirteen categories to match Angelita exactly in cents. Truncated `3 €` versus `3,67 €`, malformed thousands, missing currency and one-cent discrepancies are rejected.

- `2026-01-30`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-30-enero) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-01-30).
- `2026-02-06`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-6-febrero) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-02-06).
- `2026-02-13`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-13-febrero) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-02-13).
- `2026-03-10`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-10-marzo) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-03-10).
- `2026-04-17`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-17-abril) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-04-17).
- `2026-04-21`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-21-abril) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-04-21).
- `2026-05-26`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-26-mayo) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-05-26).
- `2026-06-09`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-9-junio) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-06-09).
- `2026-07-03`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-3-julio) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-07-03).
- `2026-08-07`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-7-agosto) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-08-07).
- `2026-08-11`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-11-agosto) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-martes-amp.php?del-dia=2026-08-11).
- `2026-09-11`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-11-septiembre) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-09-11).
- `2026-09-25`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-25-septiembre) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-09-25).
- `2026-10-02`: [Angelita](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/viernes-2-octubre) / [ComprobarEuromillones](https://www.comprobareuromillones.com/euromillones-viernes-amp.php?del-dia=2026-10-02).

Angelita's 30 January, 6 February and 13 February responses are genuine HTTP 200 “Oooops” pages without any draw. The fixtures preserve that absence; no result is fabricated. Its [17 February archive entry](https://www.loteriaangelita.com/euromillones/temporada/2026/jornada/martes-17-febrero) links its previous draw to 30 December 2025. Comprobar supplies a date-validated combination for all three dates, which can settle a losing bet but never authorise a payout without corroboration. Integration tests force SELAE HTTP 403, use these real HTML sections and verify both losing and winning bet reconciliation.
