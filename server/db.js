import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/cronograma.db";

export const DEFAULTS = {
	group_title: "8 sesiones grupales",
	group_sub: "en vivo conmigo",
	individual_title: "2 sesiones",
	individual_sub: "personalizadas",
	start_date: "2026-10-12",
	start_time: "19:00",
	duration_label: "1 hora por sesión",
};

export const FIELDS = Object.keys(DEFAULTS);

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE IF NOT EXISTS testimonials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		src TEXT NOT NULL,
		alt TEXT NOT NULL,
		position INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
`);

const SEED_TESTIMONIALS = [
	["testimonios/1.webp", "Testimonio de Natalia sobre el eneagrama"],
	["testimonios/2.webp", "Testimonio de Carlos Mario sobre el eneagrama"],
	["testimonios/3.webp", "Testimonio de Ana Lucía sobre el eneagrama"],
	["testimonios/4.webp", "Testimonio sobre el eneagrama"],
	["testimonios/5.webp", "Testimonio sobre el eneagrama"],
];

const seed = db.prepare(
	"INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
);
for (const [key, value] of Object.entries(DEFAULTS)) seed.run(key, value);

const testimonialCount = db.prepare("SELECT COUNT(*) AS n FROM testimonials").get().n;
if (testimonialCount === 0) {
	const insert = db.prepare(
		"INSERT INTO testimonials (src, alt, position) VALUES (?, ?, ?)",
	);
	SEED_TESTIMONIALS.forEach(([src, alt], index) => insert.run(src, alt, index + 1));
}

const selectAll = db.prepare("SELECT key, value FROM settings");
const upsert = db.prepare(`
	INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
	ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getSettings() {
	const rows = selectAll.all();
	const settings = { ...DEFAULTS };
	for (const { key, value } of rows) if (key in DEFAULTS) settings[key] = value;
	return settings;
}

export function saveSettings(input) {
	db.exec("BEGIN");
	try {
		for (const key of FIELDS) upsert.run(key, String(input[key] ?? "").trim());
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

const selectTestimonials = db.prepare(
	"SELECT id, src, alt, position FROM testimonials ORDER BY position, id",
);
const selectTestimonial = db.prepare(
	"SELECT id, src, alt, position FROM testimonials WHERE id = ?",
);
const nextPosition = db.prepare(
	"SELECT COALESCE(MAX(position), 0) + 1 AS position FROM testimonials",
);
const insertTestimonial = db.prepare(
	"INSERT INTO testimonials (src, alt, position) VALUES (?, ?, ?)",
);
const deleteTestimonial = db.prepare("DELETE FROM testimonials WHERE id = ?");

export function getTestimonials() {
	return selectTestimonials.all();
}

export function getTestimonial(id) {
	return selectTestimonial.get(id) ?? null;
}

export function addTestimonial(src, alt) {
	const { position } = nextPosition.get();
	const result = insertTestimonial.run(src, alt, position);
	return Number(result.lastInsertRowid);
}

export function removeTestimonial(id) {
	deleteTestimonial.run(id);
}
