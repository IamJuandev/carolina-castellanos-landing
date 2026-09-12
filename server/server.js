import express from "express";
import { readFileSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	getSettings,
	saveSettings,
	FIELDS,
	getTestimonials,
	getTestimonial,
	addTestimonial,
	removeTestimonial,
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = join(__dirname, "..", "Landing");
const PORT = Number(process.env.PORT ?? 3000);
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "data", "uploads");
const UPLOADS_URL = "/uploads";
const TESTIMONIAL_MAX_WIDTH = 1080;
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
const SESSION_COOKIE = "cronograma_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEZONE = "America/Bogota";
const TZ_OFFSET = "-05:00";

if (!ADMIN_PASSWORD) {
	console.error("ADMIN_PASSWORD env var is required");
	process.exit(1);
}

const landingTemplate = readFileSync(join(LANDING_DIR, "index.html"), "utf8");
const adminTemplate = readFileSync(join(__dirname, "cronograma.html"), "utf8");
const loginTemplate = readFileSync(join(__dirname, "login.html"), "utf8");
const adminCss = readFileSync(join(__dirname, "admin.css"), "utf8");
const kinderPage = readFileSync(join(__dirname, "kinder.html"), "utf8");

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
	day: "numeric",
	month: "long",
	timeZone: TIMEZONE,
});
const timeFormatter = new Intl.DateTimeFormat("es-CO", {
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
	timeZone: TIMEZONE,
});

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function render(template, values) {
	return template
		.replaceAll(/\{\{\{(\w+)\}\}\}/g, (_, key) => String(values[key] ?? ""))
		.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(values[key] ?? ""));
}

function renderTestimonials(testimonials) {
	const slides = testimonials
		.map(
			(t, i) =>
				`            <figure class="testimonial-slide" aria-label="Testimonio ${i + 1}">\n` +
				`              <img src="${escapeHtml(t.src)}" alt="${escapeHtml(t.alt)}" loading="lazy" />\n` +
				`            </figure>`,
		)
		.join("\n");
	const dots = testimonials
		.map(
			(_, i) =>
				`            <button type="button"${i === 0 ? ' class="active"' : ""} data-carousel-dot="${i}" aria-label="Ver testimonio ${i + 1}" aria-selected="${i === 0}"></button>`,
		)
		.join("\n");
	return { testimonial_slides: slides, testimonial_dots: dots };
}

function renderAdminTestimonials(testimonials) {
	if (!testimonials.length) {
		return '<p class="admin-hint">Aún no hay testimonios.</p>';
	}
	return testimonials
		.map(
			(t) =>
				`<li class="admin-testimonial">` +
				`<img src="${escapeHtml(t.src)}" alt="${escapeHtml(t.alt)}" loading="lazy" />` +
				`<div class="admin-testimonial-meta"><span>${escapeHtml(t.alt)}</span>` +
				`<form method="post" action="/cronograma/testimonios/${t.id}/eliminar" onsubmit="return confirm('¿Eliminar este testimonio?')">` +
				`<button class="admin-danger" type="submit">Eliminar</button></form></div></li>`,
		)
		.join("\n");
}

function deriveLabels(settings) {
	const iso = `${settings.start_date}T${settings.start_time}:00${TZ_OFFSET}`;
	const date = new Date(iso);
	const valid = !Number.isNaN(date.getTime());
	return {
		countdown_iso: valid ? iso : "",
		start_label: valid ? dateFormatter.format(date) : settings.start_date,
		time_label: valid
			? `${timeFormatter.format(date)} Bogotá`
			: settings.start_time,
	};
}

function safeEqual(a, b) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function sign(payload) {
	return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function createSessionToken() {
	const expires = String(Date.now() + SESSION_TTL_MS);
	return `${expires}.${sign(expires)}`;
}

function isValidSession(token) {
	if (!token) return false;
	const [expires, signature] = token.split(".");
	if (!expires || !signature) return false;
	if (!safeEqual(signature, sign(expires))) return false;
	return Number(expires) > Date.now();
}

function readCookie(req, name) {
	const cookies = req.headers.cookie ?? "";
	for (const part of cookies.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return decodeURIComponent(rest.join("="));
	}
	return null;
}

function requireAuth(req, res, next) {
	if (isValidSession(readCookie(req, SESSION_COOKIE))) return next();
	res.redirect(303, "/cronograma/login");
}

function renderLogin(res, status, errors) {
	res.status(status).type("html").send(render(loginTemplate, { errors }));
}

function validate(body) {
	const errors = [];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date ?? "")) {
		errors.push("La fecha de inicio no es válida.");
	}
	if (!/^\d{2}:\d{2}$/.test(body.start_time ?? "")) {
		errors.push("La hora de inicio no es válida.");
	}
	for (const key of FIELDS) {
		if (!String(body[key] ?? "").trim()) errors.push(`El campo ${key} es obligatorio.`);
	}
	return errors;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));

mkdirSync(join(UPLOADS_DIR, "testimonios"), { recursive: true });
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
	fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

function renderAdmin(res, status, values) {
	const settings = getSettings();
	res.status(status).type("html").send(
		render(adminTemplate, {
			...settings,
			...deriveLabels(settings),
			testimonials_admin: renderAdminTestimonials(getTestimonials()),
			notice: "",
			errors: "",
			...values,
		}),
	);
}

app.get("/", (_req, res) => {
	const settings = getSettings();
	res.type("html").send(
		render(landingTemplate, {
			...settings,
			...deriveLabels(settings),
			...renderTestimonials(getTestimonials()),
		}),
	);
});

app.use(UPLOADS_URL, express.static(UPLOADS_DIR, { maxAge: "7d", immutable: true }));

app.get("/kinder", (_req, res) => {
	res.type("html").send(kinderPage);
});

app.get("/admin.css", (_req, res) => {
	res.type("css").send(adminCss);
});

app.get("/cronograma/login", (req, res) => {
	if (isValidSession(readCookie(req, SESSION_COOKIE))) {
		return res.redirect(303, "/cronograma");
	}
	renderLogin(res, 200, "");
});

app.post("/cronograma/login", (req, res) => {
	const password = String(req.body.password ?? "");
	if (!safeEqual(password, ADMIN_PASSWORD)) {
		return renderLogin(res, 401, "Contraseña incorrecta.");
	}
	res.cookie(SESSION_COOKIE, createSessionToken(), {
		httpOnly: true,
		sameSite: "lax",
		secure: req.secure || req.headers["x-forwarded-proto"] === "https",
		maxAge: SESSION_TTL_MS,
		path: "/cronograma",
	});
	res.redirect(303, "/cronograma");
});

app.post("/cronograma/logout", (_req, res) => {
	res.clearCookie(SESSION_COOKIE, { path: "/cronograma" });
	res.redirect(303, "/cronograma/login");
});

const NOTICES = {
	saved: "Cambios guardados.",
	testimonial_added: "Testimonio agregado.",
	testimonial_removed: "Testimonio eliminado.",
};

app.get("/cronograma", requireAuth, (req, res) => {
	renderAdmin(res, 200, { notice: NOTICES[req.query.ok] ?? "" });
});

app.post("/cronograma/testimonios", requireAuth, (req, res) => {
	upload.single("photo")(req, res, async (uploadError) => {
		if (uploadError) {
			return renderAdmin(res, 400, {
				errors: "No se pudo subir la imagen (máximo 15 MB).",
			});
		}
		const alt = String(req.body.alt ?? "").trim();
		if (!req.file) {
			return renderAdmin(res, 400, { errors: "Selecciona una imagen." });
		}
		if (!alt) {
			return renderAdmin(res, 400, { errors: "Escribe una descripción para el testimonio." });
		}
		try {
			const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
			await sharp(req.file.buffer)
				.rotate()
				.resize({ width: TESTIMONIAL_MAX_WIDTH, withoutEnlargement: true })
				.webp({ quality: 82 })
				.toFile(join(UPLOADS_DIR, "testimonios", filename));
			addTestimonial(`${UPLOADS_URL}/testimonios/${filename}`, alt);
			res.redirect(303, "/cronograma?ok=testimonial_added#testimonios");
		} catch (error) {
			console.error("testimonial upload failed", error);
			renderAdmin(res, 500, { errors: "La imagen no se pudo procesar. Intenta con otro archivo." });
		}
	});
});

app.post("/cronograma/testimonios/:id/eliminar", requireAuth, async (req, res) => {
	const id = Number(req.params.id);
	const testimonial = Number.isInteger(id) ? getTestimonial(id) : null;
	if (!testimonial) return res.redirect(303, "/cronograma#testimonios");
	removeTestimonial(id);
	if (testimonial.src.startsWith(`${UPLOADS_URL}/`)) {
		const relative = testimonial.src.slice(UPLOADS_URL.length + 1);
		await unlink(join(UPLOADS_DIR, relative)).catch(() => {});
	}
	res.redirect(303, "/cronograma?ok=testimonial_removed#testimonios");
});

app.post("/cronograma", requireAuth, (req, res) => {
	const errors = validate(req.body);
	if (errors.length) {
		const draft = Object.fromEntries(FIELDS.map((key) => [key, req.body[key] ?? ""]));
		return renderAdmin(res, 400, {
			...draft,
			...deriveLabels(draft),
			errors: errors.join(" "),
		});
	}
	saveSettings(req.body);
	res.redirect(303, "/cronograma?ok=saved");
});

app.use(express.static(LANDING_DIR, { index: false, maxAge: "1h" }));

app.listen(PORT, () => {
	console.log(`Landing listening on http://localhost:${PORT}`);
});
