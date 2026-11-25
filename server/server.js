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
	getRelationshipSettings,
	saveRelationshipSettings,
	RELATIONSHIP_FIELDS,
	getFormSettings,
	saveFormSettings,
	FORM_FIELDS,
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
const SPEAKER_PHOTO_SIZE = 480;
const GOOGLE_FORM_TIMEOUT_MS = 10_000;
// Sign-ups are forwarded to this Google Form; its responses sheet is the registry.
const GOOGLE_FORM_ACTION =
	process.env.GOOGLE_FORM_ACTION ??
	"https://docs.google.com/forms/d/e/1FAIpQLSc-NX3pehozvYVw6u5aPyhFFV8Hlyv8SBVrjRVxxfhZWrCaYQ/formResponse";
const GOOGLE_FORM_ENTRIES = {
	full_name: "entry.232572871",
	email: "entry.1304537100",
	whatsapp: "entry.1821032806",
};
const TZ_OFFSET = "-05:00";

if (!ADMIN_PASSWORD) {
	console.error("ADMIN_PASSWORD env var is required");
	process.exit(1);
}

const landingTemplate = readFileSync(join(LANDING_DIR, "index.html"), "utf8");
const abandonmentLandingTemplate = readFileSync(join(LANDING_DIR, "heridadeabandono", "index.html"), "utf8");
const masculineEnergyLandingTemplate = readFileSync(join(LANDING_DIR, "energiamasculina", "index.html"), "utf8");
const relationshipLandingTemplate = readFileSync(join(LANDING_DIR, "relacionesdepareja", "index.html"), "utf8");
const signupFormTemplate = readFileSync(join(LANDING_DIR, "formulario", "index.html"), "utf8");
const signupThanksTemplate = readFileSync(join(LANDING_DIR, "formulario", "gracias.html"), "utf8");
const adminTemplate = readFileSync(join(__dirname, "cronograma.html"), "utf8");
const loginTemplate = readFileSync(join(__dirname, "login.html"), "utf8");
const adminCss = readFileSync(join(__dirname, "admin.css"), "utf8");
const comingSoonTemplate = readFileSync(join(__dirname, "coming-soon.html"), "utf8");

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

const weekdayDateFormatter = new Intl.DateTimeFormat("es-CO", {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: TIMEZONE,
});

// Dial codes offered on the sign-up form; the first one is the default.
const COUNTRY_CODES = [
	["+57", "Colombia"],
	["+52", "México"],
	["+54", "Argentina"],
	["+591", "Bolivia"],
	["+56", "Chile"],
	["+506", "Costa Rica"],
	["+53", "Cuba"],
	["+593", "Ecuador"],
	["+503", "El Salvador"],
	["+34", "España"],
	["+1", "Estados Unidos / Canadá"],
	["+502", "Guatemala"],
	["+504", "Honduras"],
	["+505", "Nicaragua"],
	["+507", "Panamá"],
	["+595", "Paraguay"],
	["+51", "Perú"],
	["+1787", "Puerto Rico"],
	["+1809", "República Dominicana"],
	["+598", "Uruguay"],
	["+58", "Venezuela"],
];
const COUNTRY_CODE_SET = new Set(COUNTRY_CODES.map(([code]) => code));

function renderCountryOptions(selected) {
	return COUNTRY_CODES.map(
		([code, name]) =>
			`              <option value="${code}"${code === selected ? " selected" : ""}>${escapeHtml(name)} (${code})</option>`,
	).join("\n");
}

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

function deriveFormLabels(settings) {
	const date = new Date(`${settings.start_date}T${settings.start_time}:00${TZ_OFFSET}`);
	if (Number.isNaN(date.getTime())) {
		return { date_label: settings.start_date, hour_label: settings.start_time };
	}
	const dateLabel = weekdayDateFormatter.format(date);
	return {
		date_label: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
		hour_label: timeFormatter.format(date),
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

function validate(body, fields = FIELDS) {
	const errors = [];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date ?? "")) {
		errors.push("La fecha de inicio no es válida.");
	}
	if (!/^\d{2}:\d{2}$/.test(body.start_time ?? "")) {
		errors.push("La hora de inicio no es válida.");
	}
	for (const key of fields) {
		if (!String(body[key] ?? "").trim()) errors.push(`El campo ${key} es obligatorio.`);
	}
	return errors;
}

function validateRelationship(body) {
	const errors = validate(body, RELATIONSHIP_FIELDS);
	if (body.whatsapp_url && !/^https:\/\/\S+$/.test(body.whatsapp_url.trim())) {
		errors.push("El enlace de WhatsApp debe empezar por https://.");
	}
	return errors;
}

function validateFormSettings(body) {
	const errors = validate(body, FORM_FIELDS.filter((key) => key !== "speaker_photo"));
	if (body.whatsapp_url && !/^https:\/\/\S+$/.test(body.whatsapp_url.trim())) {
		errors.push("El enlace de WhatsApp debe empezar por https://.");
	}
	return errors;
}

function validateSignup(body) {
	const errors = [];
	if (!body.full_name) errors.push("Escribe tu nombre completo.");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push("Escribe un correo electrónico válido.");
	if (!COUNTRY_CODE_SET.has(body.country_code)) errors.push("Selecciona el indicativo de tu país.");
	if (body.whatsapp.replace(/\D/g, "").length < 6) errors.push("Escribe un número de WhatsApp válido.");
	if (!body.consent) errors.push("Debes aceptar recibir la información de la clase.");
	return errors;
}

async function forwardToGoogleForm(signup) {
	const payload = new URLSearchParams();
	const values = { ...signup, whatsapp: `${signup.country_code} ${signup.whatsapp}` };
	for (const [key, entry] of Object.entries(GOOGLE_FORM_ENTRIES)) payload.set(entry, values[key]);
	const response = await fetch(GOOGLE_FORM_ACTION, {
		method: "POST",
		body: payload,
		redirect: "manual",
		signal: AbortSignal.timeout(GOOGLE_FORM_TIMEOUT_MS),
	});
	if (response.status >= 400) {
		throw new Error(`Google Form responded ${response.status}`);
	}
}

function prefixKeys(values, prefix) {
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [prefix + key, value]));
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
	// Relative asset URLs in the landing assume no trailing slash.
	if (req.path.length > 1 && req.path.endsWith("/")) {
		return res.redirect(301, req.path.slice(0, -1));
	}
	next();
});

mkdirSync(join(UPLOADS_DIR, "testimonios"), { recursive: true });
mkdirSync(join(UPLOADS_DIR, "formulario"), { recursive: true });
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
	fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

function renderAdmin(res, status, values) {
	const settings = getSettings();
	const relationship = getRelationshipSettings();
	const signupForm = getFormSettings();
	res.status(status).type("html").send(
		render(adminTemplate, {
			...settings,
			...deriveLabels(settings),
			...prefixKeys({ ...relationship, ...deriveLabels(relationship) }, "rel_"),
			rel_notice: "",
			rel_errors: "",
			...prefixKeys({ ...signupForm, ...deriveFormLabels(signupForm) }, "form_"),
			form_notice: "",
			form_errors: "",
			testimonials_admin: renderAdminTestimonials(getTestimonials()),
			notice: "",
			errors: "",
			...values,
		}),
	);
}

const BACK_HOME_CTA =
	'        <a class="button button-outline" href="/">Volver al inicio <svg class="icon button-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>';

app.get("/", (_req, res) => {
	res.type("html").send(
		render(comingSoonTemplate, {
			title: "Muy pronto",
			kicker: "Carolina Castellanos",
			headline: "Estamos construyendo este sitio",
			cta: "",
		}),
	);
});

app.use("/heridadeabandono", express.static(join(LANDING_DIR, "heridadeabandono"), { index: false, redirect: false, maxAge: "7d" }));

app.get("/heridadeabandono", (_req, res) => {
	res.type("html").send(abandonmentLandingTemplate);
});

app.use("/energiamasculina", express.static(join(LANDING_DIR, "energiamasculina"), { index: false, redirect: false, maxAge: "7d" }));

app.get("/energiamasculina", (_req, res) => {
	res.type("html").send(masculineEnergyLandingTemplate);
});

app.use("/relacionesdepareja", express.static(join(LANDING_DIR, "relacionesdepareja"), { index: false, redirect: false, maxAge: "7d" }));

app.get("/relacionesdepareja", (_req, res) => {
	const settings = getRelationshipSettings();
	res.type("html").send(
		render(relationshipLandingTemplate, {
			...settings,
			...deriveLabels(settings),
		}),
	);
});

app.use("/formulario", express.static(join(LANDING_DIR, "formulario"), { index: false, redirect: false, maxAge: "7d" }));

function renderSignupForm(res, status, values) {
	const settings = getFormSettings();
	res.status(status).type("html").send(
		render(signupFormTemplate, {
			...settings,
			...deriveFormLabels(settings),
			errors: "",
			full_name: "",
			email: "",
			whatsapp: "",
			...values,
			country_options: renderCountryOptions(values.country_code ?? COUNTRY_CODES[0][0]),
		}),
	);
}

app.get("/formulario", (_req, res) => {
	renderSignupForm(res, 200, {});
});

app.post("/formulario", async (req, res) => {
	const signup = {
		full_name: String(req.body.full_name ?? "").trim().slice(0, 120),
		email: String(req.body.email ?? "").trim().slice(0, 160),
		country_code: String(req.body.country_code ?? "").trim(),
		whatsapp: String(req.body.whatsapp ?? "").trim().slice(0, 30),
		consent: req.body.consent === "yes",
	};
	// Honeypot: bots fill the hidden field; pretend success without forwarding.
	if (String(req.body.website ?? "").trim()) {
		return res.redirect(303, "/formulario/gracias");
	}
	const errors = validateSignup(signup);
	if (errors.length) {
		return renderSignupForm(res, 400, { ...signup, errors: errors.join(" ") });
	}
	try {
		await forwardToGoogleForm(signup);
	} catch (error) {
		console.error("signup forward failed", error);
		return renderSignupForm(res, 502, {
			...signup,
			errors: "No pudimos registrar tu inscripción. Intenta de nuevo en unos minutos.",
		});
	}
	res.redirect(303, "/formulario/gracias");
});

app.get("/formulario/gracias", (_req, res) => {
	res.type("html").send(render(signupThanksTemplate, getFormSettings()));
});

app.get("/eneagrama", (_req, res) => {
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
	res.type("html").send(
		render(comingSoonTemplate, {
			title: "Kinder",
			kicker: "Kinder",
			headline: "Estamos construyendo este apartado",
			cta: BACK_HOME_CTA,
		}),
	);
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

const RELATIONSHIP_NOTICES = {
	relationship_saved: "Cambios guardados.",
};

const FORM_NOTICES = {
	form_saved: "Cambios guardados.",
};

app.get("/cronograma", requireAuth, (req, res) => {
	renderAdmin(res, 200, {
		notice: NOTICES[req.query.ok] ?? "",
		rel_notice: RELATIONSHIP_NOTICES[req.query.ok] ?? "",
		form_notice: FORM_NOTICES[req.query.ok] ?? "",
	});
});

app.post("/cronograma/relaciones", requireAuth, (req, res) => {
	const errors = validateRelationship(req.body);
	if (errors.length) {
		const draft = Object.fromEntries(RELATIONSHIP_FIELDS.map((key) => [key, req.body[key] ?? ""]));
		return renderAdmin(res, 400, {
			...prefixKeys({ ...draft, ...deriveLabels(draft) }, "rel_"),
			rel_errors: errors.join(" "),
		});
	}
	saveRelationshipSettings(req.body);
	res.redirect(303, "/cronograma?ok=relationship_saved#relaciones");
});

app.post("/cronograma/formulario", requireAuth, (req, res) => {
	upload.single("speaker_photo_file")(req, res, async (uploadError) => {
		const current = getFormSettings();
		const draft = Object.fromEntries(FORM_FIELDS.map((key) => [key, req.body?.[key] ?? ""]));
		draft.speaker_photo = current.speaker_photo;
		const fail = (status, message) =>
			renderAdmin(res, status, {
				...prefixKeys({ ...draft, ...deriveFormLabels(draft) }, "form_"),
				form_errors: message,
			});
		if (uploadError) return fail(400, "No se pudo subir la foto (máximo 15 MB).");
		const errors = validateFormSettings(draft);
		if (errors.length) return fail(400, errors.join(" "));
		if (req.file) {
			try {
				const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
				await sharp(req.file.buffer)
					.rotate()
					.resize({ width: SPEAKER_PHOTO_SIZE, height: SPEAKER_PHOTO_SIZE, fit: "cover", withoutEnlargement: true })
					.webp({ quality: 82 })
					.toFile(join(UPLOADS_DIR, "formulario", filename));
				draft.speaker_photo = `${UPLOADS_URL}/formulario/${filename}`;
			} catch (error) {
				console.error("speaker photo upload failed", error);
				return fail(500, "La foto no se pudo procesar. Intenta con otro archivo.");
			}
		}
		saveFormSettings(draft);
		if (req.file && current.speaker_photo.startsWith(`${UPLOADS_URL}/formulario/`)) {
			await unlink(join(UPLOADS_DIR, current.speaker_photo.slice(UPLOADS_URL.length + 1))).catch(() => {});
		}
		res.redirect(303, "/cronograma?ok=form_saved#formulario");
	});
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
