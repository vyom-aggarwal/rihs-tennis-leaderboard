/**
 * Demo data, embedded so the demo works with no network and no sheet.
 *
 * Imported straight from sample-data/ (written by scripts/generate_demo_data.py), so the
 * demo, the committed CSVs and the tests that read them can never drift apart. To change
 * the demo season, edit that script and re-run it.
 */

import DEMO_DOUBLES_CSV from '../sample-data/demo-doubles.csv?raw';
import DEMO_MATCHES_CSV from '../sample-data/demo-matches.csv?raw';
import DEMO_ROSTER_CSV from '../sample-data/demo-roster.csv?raw';

export { DEMO_DOUBLES_CSV, DEMO_MATCHES_CSV, DEMO_ROSTER_CSV };
