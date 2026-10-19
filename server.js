
require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));


app.use(express.static(__dirname));

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error("Faltan SMTP_USER o SMTP_PASS en el archivo .env");
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});


const pins = new Map();
const solicitudes = new Map();

function correoValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function enviarCorreo(destinatario, asunto, texto, html = null) {
    return transporter.sendMail({
        from: `"ByteCore IA Solutions" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
        to: destinatario,
        subject: asunto,
        text: texto,
        html: html || `<div style="font-family:Arial,sans-serif;white-space:pre-line;line-height:1.6;color:#172033">${escapeHtml(texto)}</div>`
    });
}

function crearHtmlPin(nombre, pin) {
    return `
      <div style="margin:0;background:#f1f5f9;padding:30px 12px;font-family:Arial,sans-serif;color:#172033">
        <div style="max-width:560px;margin:auto;background:#ffffff;border-radius:14px;overflow:hidden">
          <div style="background:#101827;padding:24px;color:#ffffff">
            <h2 style="margin:0">ByteCore IA Solutions</h2>
            <p style="margin:8px 0 0;color:#a8c4d5">Cora · Asistente virtual</p>
          </div>
          <div style="padding:28px">
            <h2>Verifica tu correo electrónico</h2>
            <p>Hola, ${escapeHtml(nombre)},</p>
            <p>Recibimos una solicitud para verificar tu correo electrónico durante el proceso de atención con Cora.</p>
            <div style="background:#eaf8f7;text-align:center;padding:24px;border-radius:10px">
              <p style="margin:0;color:#42615f">Tu código de verificación</p>
              <div style="font-size:34px;font-weight:bold;letter-spacing:6px;color:#087e78;margin:16px 0">${escapeHtml(pin)}</div>
              <p style="margin:0;color:#42615f">Válido durante 10 minutos</p>
            </div>
            <p>Introduce el código en Cora para continuar. No lo compartas con otras personas.</p>
            <hr style="border:0;border-top:1px solid #e2e8f0">
            <p style="font-size:13px;color:#64748b">Si no solicitaste este código, puedes ignorar este mensaje.</p>
            <p><strong>ByteCore IA Solutions</strong></p>
            <p style="font-size:12px;color:#64748b">Atiende. Orienta. Recomienda. Convierte.</p>
          </div>
        </div>
      </div>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

app.post("/contacto", async (req, res) => {
    const { nombre, negocio, email, tipoNegocio, mensaje } = req.body;

    if (
        typeof nombre !== "string" ||
        typeof email !== "string" ||
        typeof mensaje !== "string" ||
        !nombre.trim() ||
        !correoValido(email) ||
        !mensaje.trim()
    ) {
        return res.status(400).json({
            success: false,
            message: "Revisa el nombre, correo y mensaje."
        });
    }

    try {
        await enviarCorreo(
            process.env.SMTP_USER,
            `Nueva solicitud de ${nombre.trim()} - ByteCore`,
            `Nueva solicitud desde ByteCore IA Solutions

Nombre: ${nombre.trim()}
Negocio: ${negocio || "No especificado"}
Tipo de negocio: ${tipoNegocio || "No especificado"}
Correo: ${email.trim()}

Mensaje:
${mensaje.trim()}`
        );

        res.json({
            success: true,
            message: "Mensaje enviado correctamente."
        });
    } catch (error) {
        console.error("Error en /contacto:", error.message);
        res.status(500).json({
            success: false,
            message: "No se pudo enviar el mensaje."
        });
    }
});


app.post("/api/enviar-pin", async (req, res) => {
    const { nombre, email } = req.body;

    if (
        typeof nombre !== "string" ||
        typeof email !== "string" ||
        !nombre.trim() ||
        nombre.trim().length > 100 ||
        email.trim().length > 254 ||
        !correoValido(email.trim())
    ) {
        return res.status(400).json({
            success: false,
            message: "Introduce un nombre y un correo válidos."
        });
    }

    const correo = email.trim().toLowerCase();
    const ahora = Date.now();
    const ultimaSolicitud = solicitudes.get(correo) || 0;

    
    if (ahora - ultimaSolicitud < 60000) {
        return res.status(429).json({
            success: false,
            message: "Espera un minuto antes de solicitar otro PIN."
        });
    }

    const pin = crypto.randomInt(100000, 1000000).toString();

    
    pins.set(correo, {
        pin,
        nombre: nombre.trim(),
        expira: ahora + 10 * 60 * 1000,
        intentos: 0
    });

    solicitudes.set(correo, ahora);

    try {
        await enviarCorreo(
            correo,
            "Tu código de verificación - ByteCore Cora",
            `Hola ${nombre.trim()},

Tu código de verificación de Cora es: ${pin}

Este código caduca en 10 minutos. No lo compartas con otras personas. Si no solicitaste este código, puedes ignorar este mensaje.

ByteCore IA Solutions
Atiende. Orienta. Recomienda. Convierte.`,
            crearHtmlPin(nombre.trim(), pin)
        );

        res.json({
            success: true,
            message: "Hemos enviado el código a tu correo."
        });
    } catch (error) {
        pins.delete(correo);
        solicitudes.delete(correo);
        console.error("Error enviando PIN:", error.message);

        res.status(500).json({
            success: false,
            message: "No pudimos enviar el correo. Comprueba la configuración del servidor."
        });
    }
});


app.post("/api/verificar-pin", (req, res) => {
    const { email, pin } = req.body;

    if (
        typeof email !== "string" ||
        typeof pin !== "string" ||
        !/^\d{6}$/.test(pin)
    ) {
        return res.status(400).json({
            success: false,
            message: "Introduce el correo y el PIN de seis dígitos."
        });
    }

    const correo = email.trim().toLowerCase();
    const registro = pins.get(correo);

    if (!registro) {
        return res.status(400).json({
            success: false,
            message: "Solicita primero un código de verificación."
        });
    }

    if (Date.now() > registro.expira) {
        pins.delete(correo);
        return res.status(400).json({
            success: false,
            message: "El PIN ha caducado. Solicita uno nuevo."
        });
    }

    registro.intentos += 1;

    if (registro.intentos > 5) {
        pins.delete(correo);
        return res.status(429).json({
            success: false,
            message: "Superaste los intentos permitidos. Solicita un nuevo PIN."
        });
    }

    if (registro.pin !== pin) {
        return res.status(400).json({
            success: false,
            message: "El PIN no coincide. Comprueba el correo e inténtalo de nuevo."
        });
    }

    pins.delete(correo);

    res.json({
        success: true,
        message: "Correo verificado correctamente.",
        nombre: registro.nombre
    });
});

app.listen(PORT, () => {
    console.log(`Servidor ByteCore ejecutándose en http://localhost:${PORT}`);
});
