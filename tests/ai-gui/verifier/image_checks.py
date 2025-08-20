from typing import Tuple

import numpy as np
from PIL import Image


def avg_color_in_rect(
    img_path: str, rect: Tuple[int, int, int, int]
) -> Tuple[float, float, float]:
    x, y, w, h = rect
    with Image.open(img_path) as im:
        im = im.convert("RGB")
        crop = im.crop((x, y, x + w, y + h))
        arr = np.asarray(crop)
        if arr.size == 0:
            return (0.0, 0.0, 0.0)
        mean = arr.reshape(-1, 3).mean(axis=0)
        return tuple(float(v) for v in mean)


def likely_not_black(
    color: Tuple[float, float, float], threshold: float = 10.0
) -> bool:
    return any(c > threshold for c in color)
