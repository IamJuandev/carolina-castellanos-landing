import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSettings, saveSettings, FIELDS } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = join(__dirname, "..", "Landing");
const PORT = Number(process.env.PORT ?? 3000);
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
	return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) =>
		escapeHtml(values[key] ?? ""),
	);
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

app.get("/", (_req, res) => {
	const settings = getSettings();
	res.type("html").send(render(landingTemplate, { ...settings, ...deriveLabels(settings) }));
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

app.get("/cronograma", requireAuth, (req, res) => {
	const settings = getSettings();
	res.type("html").send(
		render(adminTemplate, {
			...settings,
			...deriveLabels(settings),
			notice: req.query.saved === "1" ? "Cambios guardados." : "",
			errors: "",
		}),
	);
});

app.post("/cronograma", requireAuth, (req, res) => {
	const errors = validate(req.body);
	if (errors.length) {
		const draft = Object.fromEntries(FIELDS.map((key) => [key, req.body[key] ?? ""]));
		return res.status(400).type("html").send(
			render(adminTemplate, {
				...draft,
				...deriveLabels(draft),
				notice: "",
				errors: errors.join(" "),
			}),
		);
	}
	saveSettings(req.body);
	res.redirect(303, "/cronograma?saved=1");
});

app.use(express.static(LANDING_DIR, { index: false, maxAge: "1h" }));

app.listen(PORT, () => {
	console.log(`Landing listening on http://localhost:${PORT}`);
});
