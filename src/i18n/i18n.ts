export type Lang = 'vi' | 'en';

const STORAGE_KEY = 'fxh-lang';
let currentLang: Lang = (localStorage.getItem(STORAGE_KEY) as Lang) === 'en' ? 'en' : 'vi';

export const getLang = (): Lang => currentLang;
export function setLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
}

const DICT: Record<string, { vi: string; en: string }> = {
  // Topbar
  'side.front': { vi: 'Mặt trước', en: 'Front' },
  'side.back': { vi: 'Mặt sau', en: 'Back' },
  'view.holo': { vi: '3D Holo', en: '3D Holo' },
  'view.flat': { vi: 'Tách bản 2D', en: 'Flat plates' },
  'top.guides': { vi: 'Lưới cắt', en: 'Guides' },
  'top.auto': { vi: 'Tự xoay', en: 'Auto spin' },
  'top.open': { vi: 'Mở', en: 'Import' },
  'top.save': { vi: 'Lưu', en: 'Save' },
  'top.new': { vi: 'Mới', en: 'New' },
  'top.dup': { vi: 'Nhân bản dự án', en: 'Duplicate project' },
  'top.closeTab': { vi: 'Đóng tab dự án', en: 'Close project tab' },
  'top.newProjTitle': { vi: 'Tạo dự án mới', en: 'New project tab' },
  'top.importTitle': { vi: 'Mở file .fxholo vào tab mới', en: 'Import .fxholo as new tab' },
  'top.saveTitle': { vi: 'Lưu dự án hiện tại (.fxholo)', en: 'Save active project (.fxholo)' },
  'top.undo': { vi: 'Hoàn tác (⌘Z)', en: 'Undo (⌘Z)' },
  'top.redo': { vi: 'Làm lại (⇧⌘Z)', en: 'Redo (⇧⌘Z)' },
  'top.projectName': { vi: 'Tên dự án', en: 'Project name' },

  // Tabs
  'tab.artwork': { vi: 'Artwork', en: 'Artwork' },
  'tab.holo': { vi: 'Holo', en: 'Holo' },
  'tab.layers': { vi: 'Layers', en: 'Layers' },
  'tab.masks': { vi: 'Masks', en: 'Masks' },
  'tab.env': { vi: 'HDRI', en: 'HDRI' },
  'tab.specs': { vi: 'Specs', en: 'Specs' },
  'tab.preflight': { vi: 'Preflight', en: 'Preflight' },
  'tab.export': { vi: 'Export', en: 'Export' },

  // Viewport HUD
  'hud.fit': { vi: 'Vừa khung', en: 'Fit' },
  'hud.hint': { vi: 'Cuộn để zoom · Space + kéo để di chuyển', en: 'Scroll to zoom · Space + drag to pan' },

  // Artwork tab
  'art.slotsTitle': { vi: 'Ảnh thẻ và lớp foil', en: 'Card and foil assets' },
  'art.downloadRef': { vi: 'Tải bộ ảnh mẫu', en: 'Download references' },
  'art.resetDefault': { vi: 'Khôi phục mặc định', en: 'Reset defaults' },
  'art.fitTitle': { vi: 'Khớp khổ in', en: 'Print fit' },
  'art.fitFront': { vi: 'Mặt trước', en: 'Front artwork' },
  'art.fitBack': { vi: 'Mặt sau', en: 'Back artwork' },
  'art.fitAuto': { vi: 'Tự nhận diện', en: 'Auto detect' },
  'art.fitBleed': { vi: 'Phủ tràn lề (Bleed)', en: 'Fill bleed' },
  'art.fitTrim': { vi: 'Vừa đường cắt (Trim)', en: 'Fit trim' },
  'art.holoSection': { vi: 'Lớp holo mặt trước', en: 'Front holo pattern' },
  'art.enableHolo': { vi: 'Bật holo', en: 'Enable holo' },
  'art.openHoloDeep': { vi: 'Cấu hình holo →', en: 'Holo settings →' },

  // Holo tab
  'holo.stackTitle': { vi: 'Danh sách lớp holo', en: 'Holo layers' },
  'holo.addLayer': { vi: 'Thêm lớp holo', en: 'Add holo layer' },
  'holo.layerName': { vi: 'Tên lớp holo', en: 'Holo layer name' },
  'holo.foilTex': { vi: 'Ảnh foil tùy chỉnh', en: 'Custom foil texture' },
  'holo.sec1': { vi: 'Quang học và vân holo', en: 'Optics and pattern' },
  'holo.sec2': { vi: 'Tương tác và chuyển động', en: 'Interaction and motion' },
  'holo.sec3': { vi: 'Mask và phạm vi', en: 'Masking and scope' },
  'holo.reset': { vi: 'Đặt lại', en: 'Reset' },
  'holo.on': { vi: 'Bật', en: 'On' },
  'holo.preset': { vi: 'Mẫu vân holo (31 kiểu)', en: 'Holo preset (31 styles)' },
  'holo.shine': { vi: 'Cường độ ánh holo', en: 'Shine intensity' },
  'holo.glare': { vi: 'Cường độ ánh lóa', en: 'Glare intensity' },
  'holo.angle': { vi: 'Góc vân cầu vồng', en: 'Rainbow angle' },
  'holo.space': { vi: 'Mật độ dải màu', en: 'Rainbow spacing' },
  'holo.scanline': { vi: 'Bước vân gạch dọc', en: 'Scanline pitch' },
  'holo.glitter': { vi: 'Kích thước hạt nhũ', en: 'Glitter scale' },
  'holo.hue': { vi: 'Xoay sắc độ', en: 'Hue shift' },
  'holo.sat': { vi: 'Độ bão hòa', en: 'Saturation' },
  'holo.bright': { vi: 'Độ sáng', en: 'Brightness' },
  'holo.contrast': { vi: 'Tương phản', en: 'Contrast' },
  'holo.blend': { vi: 'Chế độ hòa trộn', en: 'Blend mode' },
  'holo.mode': { vi: 'Chế độ tương tác', en: 'Interaction mode' },
  'holo.mode.pa': { vi: 'Chuột và tự xoay', en: 'Pointer + auto' },
  'holo.mode.p': { vi: 'Chỉ theo chuột', en: 'Pointer only' },
  'holo.mode.a': { vi: 'Chỉ tự xoay', en: 'Auto only' },
  'holo.mode.m': { vi: 'Khóa góc thủ công', en: 'Manual lock' },
  'holo.pattern': { vi: 'Quỹ đạo tự xoay', en: 'Auto trajectory' },
  'holo.pat.orbit': { vi: 'Vòng tròn', en: 'Orbit' },
  'holo.pat.fig8': { vi: 'Số 8', en: 'Figure-8' },
  'holo.pat.sx': { vi: 'Quét ngang', en: 'Horizontal sweep' },
  'holo.pat.sy': { vi: 'Quét dọc', en: 'Vertical sweep' },
  'holo.manX': { vi: 'Góc nghiêng X', en: 'Tilt X' },
  'holo.manY': { vi: 'Góc nghiêng Y', en: 'Tilt Y' },
  'holo.lightX': { vi: 'Nguồn sáng X', en: 'Light X' },
  'holo.lightY': { vi: 'Nguồn sáng Y', en: 'Light Y' },
  'holo.amp': { vi: 'Biên độ xoay', en: 'Auto amplitude' },
  'holo.freq': { vi: 'Tốc độ xoay', en: 'Auto speed' },
  'holo.sens': { vi: 'Độ nhạy chuột', en: 'Pointer sensitivity' },
  'holo.parallax': { vi: 'Độ sâu parallax', en: 'Holo parallax' },
  'holo.stiff': { vi: 'Độ cứng lò xo', en: 'Spring stiffness' },
  'holo.damp': { vi: 'Giảm chấn', en: 'Spring damping' },
  'holo.restGlow': { vi: 'Độ sáng khi nghỉ', en: 'Resting glow' },
  'holo.invertTilt': { vi: 'Đảo chiều nghiêng theo chuột', en: 'Invert tilt axis' },
  'holo.scope': { vi: 'Phạm vi áp dụng mask', en: 'Mask scope' },
  'holo.scope.shine': { vi: 'Chỉ lớp ánh holo', en: 'Holo shine only' },
  'holo.scope.sg': { vi: 'Ánh holo và ánh lóa', en: 'Holo shine + glare' },
  'holo.scope.all': { vi: 'Toàn bộ hiệu ứng holo', en: 'All holo effects' },
  'holo.scope.none': { vi: 'Bỏ qua mask (phủ toàn thẻ)', en: 'Bypass mask (full card)' },
  'holo.choke': { vi: 'Choke / Spread', en: 'Choke / Spread' },
  'holo.feather': { vi: 'Làm mềm viền', en: 'Edge feather' },
  'holo.invertMask': { vi: 'Đảo ngược vùng mask (nhân vật ↔ nền)', en: 'Invert holo mask (subject ↔ background)' },
  'holo.previewMask': { vi: 'Hiện lớp phủ vùng mask trên thẻ 3D', en: 'Show holo mask overlay on 3D card' },
  'holo.exportPlate': { vi: 'Xuất holo mask thành bản in (Spot: HoloFoil)', en: 'Export holo mask as plate (Spot: HoloFoil)' },
  'holo.uploadMask': { vi: 'Tải mask', en: 'Upload mask' },
  'holo.fromFront': { vi: 'Tạo từ mặt trước', en: 'From front' },
  'holo.assignMask': { vi: 'Gán mask', en: 'Assign mask' },
  'holo.noMasks': { vi: 'Chưa gắn mask — hiệu ứng đang phủ toàn thẻ', en: 'No masks assigned — applying across full card' },

  // Layers tab
  'layers.addTitle': { vi: 'Thêm lớp kỹ thuật in', en: 'Add print technique' },
  'layers.stackTitle': { vi: 'Lớp bản in', en: 'Print layers' },
  'layers.empty': { vi: 'Chưa có lớp nào ở mặt này. Chọn kỹ thuật ở trên để thêm', en: 'No layers on this side yet. Select a technique above to add one' },
  'layers.soloExit': { vi: 'Đang xem riêng 1 lớp — bấm S để hiện lại', en: 'Solo active — click S to restore' },
  'layers.props': { vi: 'Thuộc tính lớp', en: 'Layer properties' },
  'layers.plateName': { vi: 'Tên bản in', en: 'Plate name' },
  'layers.opacity': { vi: 'Độ mờ', en: 'Opacity' },
  'layers.trapping': { vi: 'Choke / Spread', en: 'Choke / Spread' },
  'layers.invert': { vi: 'Đảo ngược vùng mask của lớp này', en: 'Invert layer mask' },
  'layers.maskOverlay': { vi: 'Hiện lớp phủ vùng mask trên 3D và 2D', en: 'Show layer mask overlay on 3D and 2D' },
  'layers.maskStack': { vi: 'Kết hợp mask (Boolean)', en: 'Mask stack (Boolean)' },
  'layers.addMask': { vi: 'Thêm mask', en: 'Add mask' },
  'layers.noMask': { vi: 'Chưa gắn mask nào', en: 'No masks assigned' },
  'layers.lockedHint': { vi: 'Lớp đang khóa — mở khóa để chỉnh sửa', en: 'Layer is locked — unlock to edit' },
  'layers.dup': { vi: 'Nhân bản', en: 'Duplicate' },
  'layers.del': { vi: 'Xóa', en: 'Delete' },
  'layers.solo': { vi: 'Xem riêng lớp này', en: 'Solo layer' },
  'layers.lock': { vi: 'Khóa hoặc mở khóa', en: 'Lock or unlock' },
  'layers.vis': { vi: 'Ẩn hoặc hiện', en: 'Show or hide' },
  'layers.dblRename': { vi: 'Nhấp đúp để đổi tên', en: 'Double-click to rename' },

  // Masks tab
  'masks.createTitle': { vi: 'Tạo hoặc tải mask dùng chung', en: 'Create or upload shared mask' },
  'masks.upload': { vi: 'Tải ảnh mask', en: 'Upload mask' },
  'masks.fromArt': { vi: 'Từ artwork', en: 'From artwork' },
  'masks.solid': { vi: 'Phủ đặc', en: 'Solid' },
  'masks.libTitle': { vi: 'Thư viện mask', en: 'Mask library' },
  'masks.editTitle': { vi: 'Hiệu chỉnh mask', en: 'Mask inspector' },
  'masks.name': { vi: 'Tên mask', en: 'Mask name' },
  'masks.mode': { vi: 'Chế độ trích xuất', en: 'Extraction mode' },
  'masks.fit': { vi: 'Khớp khổ', en: 'Fit mode' },
  'masks.pickColor': { vi: 'Màu chọn', en: 'Target color' },
  'masks.threshold': { vi: 'Ngưỡng nhị phân 1-bit', en: 'Binary threshold (1-bit)' },
  'masks.thresholdVal': { vi: 'Ngưỡng cắt', en: 'Threshold' },
  'masks.invert': { vi: 'Đảo ngược mask', en: 'Invert mask' },

  // Env / HDRI tab
  'env.presetsTitle': { vi: 'Môi trường ánh sáng HDRI', en: 'HDRI lighting environments' },
  'env.customTitle': { vi: 'Ảnh HDRI hoặc panorama tùy chỉnh', en: 'Custom HDRI or panorama map' },
  'env.uploadBtn': { vi: 'Tải ảnh HDRI (JPG, PNG, WebP)', en: 'Upload HDRI image (JPG, PNG, WebP)' },
  'env.clearCustom': { vi: 'Dùng preset mặc định', en: 'Use built-in preset' },
  'env.customActive': { vi: 'Đang dùng ảnh HDRI tùy chỉnh', en: 'Custom HDRI map active' },
  'env.customHint': { vi: 'Hỗ trợ ảnh panorama 360° (tỉ lệ 2:1) hoặc ảnh môi trường bất kỳ để tạo phản xạ lên foil, spot UV và emboss', en: 'Supports 360° equirectangular panoramas (2:1) or any environment photo for foil, spot UV, and emboss reflections' },
  'env.lightTitle': { vi: 'Ánh sáng và góc phản xạ', en: 'Lighting and reflection' },
  'env.rotation': { vi: 'Xoay môi trường', en: 'Environment rotation' },
  'env.exposure': { vi: 'Phơi sáng', en: 'Exposure' },
  'env.temperature': { vi: 'Nhiệt độ màu', en: 'Color temperature' },
  'env.elevation': { vi: 'Độ cao nguồn sáng', en: 'Light elevation' },
  'env.backdropTitle': { vi: 'Nền không gian 3D', en: '3D stage backdrop' },
  'env.showBackdrop': { vi: 'Hiện nền HDRI phía sau thẻ 3D', en: 'Show HDRI backdrop behind 3D card' },
  'env.backdropBlur': { vi: 'Độ mờ nền', en: 'Backdrop blur' },
  'env.backdropDim': { vi: 'Độ sáng nền', en: 'Backdrop brightness' },
  'env.reset': { vi: 'Đặt lại', en: 'Reset' },

  // Specs tab
  'specs.sizeTitle': { vi: 'Khổ thẻ và đơn vị', en: 'Card dimensions and units' },
  'specs.preset': { vi: 'Khổ thẻ chuẩn', en: 'Card size preset' },
  'specs.unit': { vi: 'Đơn vị hiển thị', en: 'Display unit' },
  'specs.width': { vi: 'Chiều rộng (Trim)', en: 'Trim width' },
  'specs.height': { vi: 'Chiều cao (Trim)', en: 'Trim height' },
  'specs.bleed': { vi: 'Tràn lề (Bleed)', en: 'Bleed' },
  'specs.safe': { vi: 'Vùng an toàn', en: 'Safe zone' },
  'specs.corner': { vi: 'Bo góc', en: 'Corner radius' },
  'specs.substrate': { vi: 'Chất liệu nền', en: 'Substrate' },
  'specs.subWhite': { vi: 'Giấy trắng', en: 'White cardstock' },
  'specs.subMetal': { vi: 'Nền ánh kim / Foil', en: 'Metallic / Foil stock' },
  'specs.totalBleed': { vi: 'Tổng khổ cả tràn lề', en: 'Full bleed size' },
  'specs.dpiTitle': { vi: 'Độ phân giải và ngưỡng preflight', en: 'Resolution and preflight thresholds' },
  'specs.artDpi': { vi: 'Artwork DPI', en: 'Artwork DPI' },
  'specs.plateDpi': { vi: 'Plate DPI', en: 'Plate DPI' },
  'specs.minFoil': { vi: 'Nét foil tối thiểu (mm)', en: 'Min foil line (mm)' },
  'specs.minEmboss': { vi: 'Nét emboss tối thiểu (mm)', en: 'Min emboss line (mm)' },

  // Preflight tab
  'pf.title': { vi: 'Kiểm tra tiền in', en: 'Pre-press preflight' },
  'pf.run': { vi: 'Chạy kiểm tra preflight', en: 'Run preflight check' },
  'pf.summary': { vi: '{e} lỗi · {w} cảnh báo — bấm từng mục để xem vị trí', en: '{e} errors · {w} warnings — select an item to inspect' },

  // Export tab
  'exp.title': { vi: 'Gói file sản xuất (.zip)', en: 'Production package (.zip)' },
  'exp.pdf': { vi: 'print_ready.pdf (TrimBox, BleedBox, Spot Colors, CutContour)', en: 'print_ready.pdf (TrimBox, BleedBox, Spot Colors, CutContour)' },
  'exp.tiffs': { vi: 'Ảnh TIFF từng mặt ({a} DPI) và từng bản in ({p} DPI)', en: 'Artwork TIFFs ({a} DPI) and plate TIFFs ({p} DPI)' },
  'exp.holo': { vi: 'HoloPattern.tif, HoloMask.tif, foil gốc và PDF Spot', en: 'HoloPattern.tif, HoloMask.tif, foil source, and PDF Spot' },
  'exp.dieline': { vi: 'dieline.svg (đường cắt chuẩn mm)', en: 'dieline.svg (exact mm cut path)' },
  'exp.mockup': { vi: 'preview_mockup.png (ảnh mockup 2 mặt)', en: 'preview_mockup.png (front and back mockup)' },
  'exp.video': { vi: 'Kèm video 3D 1080p 10s (preview_mockup_3d_1080p.mp4)', en: 'Include 1080p 10s 3D video (preview_mockup_3d_1080p.mp4)' },
  'exp.spec': { vi: 'spec_sheet.pdf và spec.json (tiếng Anh)', en: 'spec_sheet.pdf and spec.json (English)' },
  'exp.btn': { vi: 'Xuất gói sản xuất (.zip)', en: 'Export production ZIP' },
  'exp.videoBtn': { vi: 'Xuất riêng video 3D (.mp4 · 1080p · 10s)', en: 'Export 3D proof video (.mp4 · 1080p · 10s)' },
  'exp.busy': { vi: 'Đang xuất file...', en: 'Exporting...' },
  'exp.projTitle': { vi: 'File dự án (.fxholo)', en: 'Project file (.fxholo)' },
  'exp.saveProj': { vi: 'Lưu .fxholo', en: 'Save .fxholo' },
  'exp.openProj': { vi: 'Mở .fxholo', en: 'Open .fxholo' },

  // Misc
  'slider.resetTitle': { vi: 'Đặt lại mặc định ({v})', en: 'Reset to default ({v})' },
  'flat.artwork': { vi: 'Artwork', en: 'Artwork' },
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let str = entry ? entry[currentLang] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, String(v));
  }
  return str;
}
