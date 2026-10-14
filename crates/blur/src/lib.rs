use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct Region { x: f32, y: f32, width: f32, height: f32, angle: f32, shape: String, enabled: bool }

#[wasm_bindgen]
pub fn blur_rgba(input: &[u8], width: u32, height: u32, regions: JsValue, strength: u32, style: &str) -> Result<Vec<u8>, JsValue> {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 || input.len() != w.saturating_mul(h).saturating_mul(4) {
        return Err(JsValue::from_str("Ukuran gambar tidak valid."));
    }
    let regions: Vec<Region> = serde_wasm_bindgen::from_value(regions).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut output = input.to_vec();
    let cell_size = strength.clamp(8, 64) as f32;
    for r in regions.into_iter().filter(|r| r.enabled && r.width >= 1.0 && r.height >= 1.0) {
        let half_w = r.width * 0.5; let half_h = r.height * 0.5;
        let cx = r.x + half_w; let cy = r.y + half_h;
        let (sin, cos) = r.angle.to_radians().sin_cos();
        let ex = cos.abs() * half_w + sin.abs() * half_h;
        let ey = sin.abs() * half_w + cos.abs() * half_h;
        let left = (cx - ex).floor().max(0.0) as i32;
        let right = (cx + ex).ceil().min(width as f32 - 1.0) as i32;
        let top = (cy - ey).floor().max(0.0) as i32;
        let bottom = (cy + ey).ceil().min(height as f32 - 1.0) as i32;
        if right < left || bottom < top { continue; }
        let cols = (r.width / cell_size).ceil().max(1.0) as usize;
        let rows = (r.height / cell_size).ceil().max(1.0) as usize;
        let mut sums = vec![[0u64; 3]; cols * rows];
        let mut counts = vec![0u32; cols * rows];
        let mut coords = Vec::new();
        let ellipse = r.shape == "oval";
        for y in top..=bottom { for x in left..=right {
            let dx = x as f32 + 0.5 - cx; let dy = y as f32 + 0.5 - cy;
            let lx = dx * cos + dy * sin; let ly = -dx * sin + dy * cos;
            let inside = if ellipse { (lx / half_w).powi(2) + (ly / half_h).powi(2) <= 1.0 }
                else { lx.abs() <= half_w && ly.abs() <= half_h };
            if !inside { continue; }
            let gx = ((lx + half_w) / cell_size).floor().max(0.0) as usize;
            let gy = ((ly + half_h) / cell_size).floor().max(0.0) as usize;
            let cell = gy.min(rows - 1) * cols + gx.min(cols - 1);
            let offset = (y as usize * w + x as usize) * 4;
            for c in 0..3 { sums[cell][c] += input[offset + c] as u64; }
            counts[cell] += 1; coords.push((x as usize, y as usize, cell));
        }}
        for (x, y, cell) in coords {
            let offset = (y * w + x) * 4;
            for c in 0..3 {
                let value = if style == "halus" {
                    let gx = cell % cols; let gy = cell / cols;
                    let mut total = 0u64; let mut n = 0u64;
                    for yy in gy.saturating_sub(1)..=(gy + 1).min(rows - 1) {
                        for xx in gx.saturating_sub(1)..=(gx + 1).min(cols - 1) {
                            let index = yy * cols + xx;
                            if counts[index] > 0 { total += sums[index][c] / counts[index] as u64; n += 1; }
                        }
                    }
                    if n > 0 { (total / n) as u8 } else { input[offset + c] }
                } else if counts[cell] > 0 { (sums[cell][c] / counts[cell] as u64) as u8 }
                else { input[offset + c] };
                output[offset + c] = value;
            }
        }
    }
    Ok(output)
}
