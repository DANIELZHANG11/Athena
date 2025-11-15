import sys
def calc(slo_percent: float, days: int):
    total = days * 24 * 60
    allowed = total * (1 - slo_percent / 100.0)
    return int(allowed)
if __name__ == "__main__":
    slo = float(sys.argv[1]) if len(sys.argv) > 1 else 99.9
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    mins = calc(slo, days)
    print(f"SLO={slo}% over {days}d -> error budget {mins} min")