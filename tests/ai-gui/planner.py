import random
from typing import Any, Dict, List


class Planner:
    def __init__(self, width: int = 1920, height: int = 1080):
        self.width = width
        self.height = height

    def propose_overlays(self, n: int = 3) -> List[Dict[str, Any]]:
        overlays = []
        for _ in range(n):
            w, h = random.randint(80, 260), random.randint(40, 160)
            x, y = random.randint(0, max(0, self.width - w)), random.randint(
                0, max(0, self.height - h)
            )
            color = random.choice(
                ["red", "green", "blue", "yellow", "magenta", "cyan", "lime", "orange"]
            )
            label = random.choice(["A", "B", "C", "Click", "Look", "Test"])
            overlays.append(
                {
                    "x": x,
                    "y": y,
                    "width": w,
                    "height": h,
                    "color": color,
                    "label": label,
                }
            )
        return overlays
