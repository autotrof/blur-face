use rustface::{Detector, ImageData};
use serde::Serialize;
use std::{cell::RefCell, io::Cursor};
use wasm_bindgen::prelude::*;

const MODEL: &[u8] = include_bytes!("../../../models/seeta_fd_frontal_v1.0.bin");

thread_local! {
    static DETECTOR: RefCell<Option<Box<dyn Detector>>> = const { RefCell::new(None) };
}

#[derive(Serialize)]
struct Face { x: i32, y: i32, width: u32, height: u32, score: f64 }

#[wasm_bindgen]
pub fn detect_faces(gray: &[u8], width: u32, height: u32, minimum: u32) -> Result<JsValue, JsValue> {
    if width == 0 || height == 0 || gray.len() != (width as usize).saturating_mul(height as usize) {
        return Err(JsValue::from_str("Ukuran gambar tidak valid."));
    }
    DETECTOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() {
            let model = rustface::read_model(Cursor::new(MODEL))
                .map_err(|e| JsValue::from_str(&format!("Model wajah gagal dibaca: {e}")))?;
            let mut detector = rustface::create_detector_with_model(model);
            detector.set_score_thresh(2.0);
            detector.set_pyramid_scale_factor(0.8);
            detector.set_slide_window_step(4, 4);
            *slot = Some(detector);
        }
        let detector = slot.as_mut().expect("initialized");
        detector.set_min_face_size(minimum.max(20));
        let image = ImageData::new(gray, width, height);
        let found = detector.detect(&image).into_iter().map(|face| {
            let r = face.bbox();
            Face { x: r.x(), y: r.y(), width: r.width(), height: r.height(), score: face.score() }
        }).collect::<Vec<_>>();
        serde_wasm_bindgen::to_value(&found).map_err(|e| JsValue::from_str(&e.to_string()))
    })
}
