"""Build full 1..110 XP tables from cookierun_level_table.md."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_JS = ROOT / "js" / "level_xp.js"

# Cumulative EXP to reach level (markdown). Sparse early; complete 51–110.
CUM_MARKDOWN = {
    1: 0,
    2: 1500,
    3: 4000,
    4: 9000,
    5: 15000,
    10: 75000,
    20: 380000,
    30: 870000,
    40: 1575600,
    50: 4452600,
    51: 4803600,
    52: 5183600,
    53: 5593600,
    54: 6083600,
    55: 6621600,
    56: 7215500,
    57: 7867690,
    58: 8585090,
    59: 9374249,
    60: 10599314,
    61: 11010000,
    62: 11500000,
    63: 12040000,
    64: 12690000,
    65: 13410000,
    66: 13820000,
    67: 14820000,
    68: 16020000,
    69: 17520000,
    70: 19520000,
    71: 20220000,
    72: 21120000,
    73: 22220000,
    74: 23620000,
    75: 25320000,
    76: 27320000,
    77: 29620000,
    78: 32220000,
    79: 35220000,
    80: 38720000,
    81: 39620000,
    82: 40720000,
    83: 42020000,
    84: 43620000,
    85: 45520000,
    86: 47720000,
    87: 50220000,
    88: 53220000,
    89: 56720000,
    90: 60720000,
    91: 61920000,
    92: 63420000,
    93: 65220000,
    94: 67320000,
    95: 69720000,
    96: 72520000,
    97: 75720000,
    98: 79320000,
    99: 83320000,
    100: 87820000,
    101: 89220000,
    102: 91220000,
    103: 93720000,
    104: 97020000,
    105: 101020000,
    106: 105620000,
    107: 111020000,
    108: 117120000,
    109: 124120000,
    110: 131620000,
}


def build_tables():
    # Fill 1–50 gaps by linear interpolation of cumulative between known keys
    known = sorted(k for k in CUM_MARKDOWN if k <= 50)
    cum: dict[int, int] = {}
    for i in range(len(known) - 1):
        a, b = known[i], known[i + 1]
        ca, cb = CUM_MARKDOWN[a], CUM_MARKDOWN[b]
        cum[a] = ca
        for lv in range(a + 1, b):
            t = (lv - a) / (b - a)
            cum[lv] = int(round(ca + (cb - ca) * t))
        cum[b] = cb

    # 51–110 exact from markdown
    for lv in range(51, 111):
        cum[lv] = CUM_MARKDOWN[lv]

    req = {1: 0}
    for lv in range(2, 111):
        req[lv] = max(0, cum[lv] - cum[lv - 1])
    return req, cum


def main():
    req, cum = build_tables()
    need = cum[75] - cum[25]
    print("cum25", cum[25], "cum75", cum[75], "25->75", need)
    assert need == 24695000, need

    lines = [
        "/* Auto-generated from cookierun_level_table.md via tools/build_level_xp.py */",
        "(function (global) {",
        '  "use strict";',
        "  const XP_TO_REACH = {",
    ]
    for lv in range(1, 111):
        lines.append(f"    {lv}: {req[lv]},")
    lines.append("  };")
    lines.append("  const XP_CUMULATIVE = {")
    for lv in range(1, 111):
        lines.append(f"    {lv}: {cum[lv]},")
    lines += [
        "  };",
        "",
        "  function getLevelBonus(level) {",
        "    const lv = Number(level) || 0;",
        "    if (lv <= 50) return Math.max(0, lv - 1);",
        "    return Number((44 + lv * 0.1).toFixed(2));",
        "  }",
        "",
        "  /** XP from start of currentLevel → start of targetLevel (0% progress). */",
        "  function calculateRequiredXp(currentLevel, targetLevel) {",
        "    const cur = Math.floor(Number(currentLevel));",
        "    const tgt = Math.floor(Number(targetLevel));",
        "    if (!Number.isFinite(cur) || !Number.isFinite(tgt)) return null;",
        "    if (cur < 1 || tgt < 1 || cur > 110 || tgt > 110) return null;",
        "    if (tgt <= cur) return 0;",
        "    return XP_CUMULATIVE[tgt] - XP_CUMULATIVE[cur];",
        "  }",
        "",
        "  global.CKR_LEVEL_XP = {",
        "    XP_TO_REACH,",
        "    XP_CUMULATIVE,",
        "    getLevelBonus,",
        "    calculateRequiredXp,",
        "    MAX_LEVEL: 110,",
        "  };",
        "})(window);",
        "",
    ]
    OUT_JS.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", OUT_JS)


if __name__ == "__main__":
    main()
