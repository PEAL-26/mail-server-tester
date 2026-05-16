/**
 * Mail Server Tester — servidor Node.js
 * Serve o frontend e expõe endpoints REST para teste real de SMTP e IMAP
 *
 * Endpoints:
 *   POST /api/smtp/test   — testa conexão + autenticação SMTP e envia email
 *   POST /api/imap/test   — testa conexão + autenticação IMAP e lista caixas
 *   GET  /api/health      — status do servidor
 */

const express = require('express');
const nodemailer = require('nodemailer');
const Imap = require('imap');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function ts() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function logStep(steps, message, type = 'info') {
  steps.push({ time: ts(), message, type });
}

function errorDetail(err) {
  return {
    message: err.message || String(err),
    code: err.code || null,
    syscall: err.syscall || null,
    address: err.address || null,
    port: err.port || null,
    stack: err.stack || null,
    response: err.response || null,
    responseCode: err.responseCode || null,
    command: err.command || null,
  };
}

// ─────────────────────────────────────────────
// POST /api/smtp/test
// ─────────────────────────────────────────────
//
// Body:
// {
//   host: string,
//   port: number,
//   security: "SSL" | "TLS" | "NONE",
//   user: string,
//   pass: string,
//   from: string,
//   to: string,
//   subject?: string,
//   body?: string
// }

app.post('/api/smtp/test', async (req, res) => {
  const { host, port, security, user, pass, from, to, subject, body } = req.body;
  const steps = [];

  // Validações
  if (!host)        return res.status(400).json({ ok: false, error: 'host é obrigatório' });
  if (!port)        return res.status(400).json({ ok: false, error: 'port é obrigatório' });
  if (!user)        return res.status(400).json({ ok: false, error: 'user é obrigatório' });
  if (!pass)        return res.status(400).json({ ok: false, error: 'pass é obrigatório' });
  if (!from)        return res.status(400).json({ ok: false, error: 'from é obrigatório' });
  if (!to)          return res.status(400).json({ ok: false, error: 'to é obrigatório' });

  logStep(steps, `Iniciando teste SMTP`, 'info');
  logStep(steps, `Host: ${host}  Porta: ${port}  Segurança: ${security}`, 'info');
  logStep(steps, `Usuário: ${user}`, 'info');
  logStep(steps, `De: ${from}  Para: ${to}`, 'info');

  // Monta config nodemailer
  const secure = security === 'SSL';
  const requireTLS = security === 'TLS';

  const transportConfig = {
    host,
    port: Number(port),
    secure,
    requireTLS,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false, // permite certificados self-signed
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
  };

  if (security === 'NONE') {
    transportConfig.secure = false;
    transportConfig.requireTLS = false;
    delete transportConfig.tls;
  }

  const transporter = nodemailer.createTransport(transportConfig);

  // 1. Verifica conexão
  logStep(steps, `Conectando em ${host}:${port}...`, 'info');
  try {
    await transporter.verify();
    logStep(steps, `Conexão e autenticação OK`, 'ok');
  } catch (err) {
    const detail = errorDetail(err);
    logStep(steps, `Falha na conexão/autenticação: ${detail.message}`, 'error');

    // Diagnóstico contextual
    if (detail.code === 'ECONNREFUSED') {
      logStep(steps, `Porta ${port} recusou a conexão — verifique se o serviço SMTP está ativo e a porta está correta`, 'warn');
    } else if (detail.code === 'ETIMEDOUT' || detail.code === 'ECONNRESET') {
      logStep(steps, `Timeout/Reset — firewall pode estar bloqueando a porta ${port}`, 'warn');
    } else if (detail.code === 'ENOTFOUND') {
      logStep(steps, `Host "${host}" não encontrado — verifique o DNS`, 'warn');
    } else if (detail.responseCode === 535 || (detail.message && detail.message.includes('535'))) {
      logStep(steps, `Credenciais rejeitadas pelo servidor (535) — usuário/senha incorretos`, 'warn');
    } else if (detail.message && detail.message.toLowerCase().includes('starttls')) {
      logStep(steps, `Problema com STARTTLS — tente mudar o tipo de segurança para SSL/TLS ou Nenhum`, 'warn');
    } else if (detail.message && detail.message.toLowerCase().includes('certificate')) {
      logStep(steps, `Erro de certificado TLS — o servidor pode usar certificado autoassinado`, 'warn');
    }

    return res.json({
      ok: false,
      phase: 'connection',
      steps,
      error: detail,
    });
  }

  // 2. Envia email de teste
  const mailSubject = subject || `🔧 Teste SMTP — ${new Date().toLocaleString('pt-BR')}`;
  const mailBody = body || `Este é um email de teste enviado pelo Mail Server Tester.\n\nServidor: ${host}:${port}\nSegurança: ${security}\nData/Hora: ${ts()}`;

  logStep(steps, `Enviando email de teste para ${to}...`, 'info');
  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: mailSubject,
      text: mailBody,
      html: `<div style="font-family:monospace;background:#0d0f14;color:#e0e6f0;padding:24px;border-radius:8px;">
        <h2 style="color:#4f8ef7;margin-bottom:16px;">✅ Teste SMTP bem-sucedido</h2>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="color:#6a7490;padding:4px 0;width:120px;">Servidor</td><td>${host}:${port}</td></tr>
          <tr><td style="color:#6a7490;padding:4px 0;">Segurança</td><td>${security}</td></tr>
          <tr><td style="color:#6a7490;padding:4px 0;">Remetente</td><td>${from}</td></tr>
          <tr><td style="color:#6a7490;padding:4px 0;">Destinatário</td><td>${to}</td></tr>
          <tr><td style="color:#6a7490;padding:4px 0;">Data/Hora</td><td>${ts()}</td></tr>
        </table>
        <p style="margin-top:16px;color:#2ecc8a;">Email enviado com sucesso pelo Mail Server Tester 📡</p>
      </div>`,
    });

    logStep(steps, `Email enviado com sucesso!`, 'ok');
    logStep(steps, `Message-ID: ${info.messageId}`, 'ok');
    logStep(steps, `Resposta do servidor: ${info.response}`, 'ok');
    if (info.accepted && info.accepted.length) {
      logStep(steps, `Aceito para: ${info.accepted.join(', ')}`, 'ok');
    }
    if (info.rejected && info.rejected.length) {
      logStep(steps, `Rejeitado para: ${info.rejected.join(', ')}`, 'warn');
    }

    return res.json({
      ok: true,
      phase: 'sent',
      steps,
      result: {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
        envelope: info.envelope,
      },
    });
  } catch (err) {
    const detail = errorDetail(err);
    logStep(steps, `Falha no envio: ${detail.message}`, 'error');

    if (detail.responseCode === 550) {
      logStep(steps, `Endereço destinatário rejeitado (550) — verifique o email de destino`, 'warn');
    } else if (detail.responseCode === 553) {
      logStep(steps, `Remetente inválido (553) — verifique o campo "De"`, 'warn');
    } else if (detail.responseCode === 421 || detail.responseCode === 450) {
      logStep(steps, `Servidor temporariamente indisponível — tente novamente`, 'warn');
    }

    return res.json({
      ok: false,
      phase: 'send',
      steps,
      error: detail,
    });
  }
});

// ─────────────────────────────────────────────
// POST /api/imap/test
// ─────────────────────────────────────────────
//
// Body:
// {
//   host: string,
//   port: number,
//   security: "SSL" | "TLS" | "NONE",
//   user: string,
//   pass: string
// }

app.post('/api/imap/test', (req, res) => {
  const { host, port, security, user, pass } = req.body;
  const steps = [];

  if (!host) return res.status(400).json({ ok: false, error: 'host é obrigatório' });
  if (!port) return res.status(400).json({ ok: false, error: 'port é obrigatório' });
  if (!user) return res.status(400).json({ ok: false, error: 'user é obrigatório' });
  if (!pass) return res.status(400).json({ ok: false, error: 'pass é obrigatório' });

  logStep(steps, `Iniciando teste IMAP`, 'info');
  logStep(steps, `Host: ${host}  Porta: ${port}  Segurança: ${security}`, 'info');
  logStep(steps, `Usuário: ${user}`, 'info');

  const imapConfig = {
    user,
    password: pass,
    host,
    port: Number(port),
    tls: security === 'SSL',
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 10000,
    authTimeout: 8000,
  };

  if (security === 'TLS') {
    imapConfig.tls = false;
    imapConfig.starttls = true;
  }

  const imap = new Imap(imapConfig);
  let responded = false;

  function done(payload) {
    if (responded) return;
    responded = true;
    try { imap.end(); } catch (_) {}
    return res.json(payload);
  }

  imap.once('ready', () => {
    logStep(steps, `Conexão e autenticação IMAP OK`, 'ok');
    logStep(steps, `Listando caixas de entrada...`, 'info');

    imap.getBoxes((err, boxes) => {
      if (err) {
        const detail = errorDetail(err);
        logStep(steps, `Erro ao listar caixas: ${detail.message}`, 'error');
        return done({ ok: false, phase: 'listBoxes', steps, error: detail });
      }

      const boxList = flattenBoxes(boxes);
      boxList.forEach(b => logStep(steps, `Caixa encontrada: ${b}`, 'ok'));
      logStep(steps, `Total de caixas: ${boxList.length}`, 'ok');

      // Tenta abrir INBOX para contar mensagens
      logStep(steps, `Abrindo INBOX...`, 'info');
      imap.openBox('INBOX', true, (err2, box) => {
        if (err2) {
          logStep(steps, `Não foi possível abrir INBOX: ${err2.message}`, 'warn');
        } else {
          logStep(steps, `INBOX aberta — Total: ${box.messages.total} mensagens, Não lidas: ${box.messages.unseen || '?'}`, 'ok');
        }
        done({
          ok: true,
          phase: 'done',
          steps,
          result: {
            boxes: boxList,
            inbox: err2 ? null : {
              total: box.messages.total,
              unseen: box.messages.unseen,
              uidvalidity: box.uidvalidity,
            },
          },
        });
      });
    });
  });

  imap.once('error', (err) => {
    const detail = errorDetail(err);
    logStep(steps, `Erro IMAP: ${detail.message}`, 'error');

    if (detail.code === 'ECONNREFUSED') {
      logStep(steps, `Porta ${port} recusou conexão — verifique se o serviço IMAP está ativo`, 'warn');
    } else if (detail.code === 'ETIMEDOUT') {
      logStep(steps, `Timeout — firewall pode estar bloqueando a porta ${port}`, 'warn');
    } else if (detail.code === 'ENOTFOUND') {
      logStep(steps, `Host "${host}" não encontrado — verifique o DNS`, 'warn');
    } else if (detail.message && detail.message.includes('Invalid credentials')) {
      logStep(steps, `Credenciais inválidas — usuário/senha incorretos`, 'warn');
    } else if (detail.message && detail.message.toLowerCase().includes('certificate')) {
      logStep(steps, `Erro de certificado TLS — servidor pode usar certificado autoassinado`, 'warn');
    } else if (detail.message && detail.message.includes('AUTHENTICATIONFAILED')) {
      logStep(steps, `Autenticação falhou — verifique usuário e senha`, 'warn');
    }

    done({ ok: false, phase: 'connection', steps, error: detail });
  });

  imap.once('end', () => {
    logStep(steps, `Conexão IMAP encerrada`, 'info');
  });

  logStep(steps, `Conectando em ${host}:${port} (${security})...`, 'info');
  imap.connect();
});

// ─────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    server: 'Mail Server Tester',
    version: '1.0.0',
    time: ts(),
    node: process.version,
  });
});

// Serve index.html para qualquer rota não reconhecida
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function flattenBoxes(boxes, prefix = '') {
  const result = [];
  for (const [name, box] of Object.entries(boxes || {})) {
    const full = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name;
    result.push(full);
    if (box.children) {
      result.push(...flattenBoxes(box.children, full));
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n📡 Mail Server Tester rodando em http://localhost:${PORT}`);
  console.log(`   Frontend: http://localhost:${PORT}`);
  console.log(`   API SMTP: POST http://localhost:${PORT}/api/smtp/test`);
  console.log(`   API IMAP: POST http://localhost:${PORT}/api/imap/test`);
  console.log(`   Health:   GET  http://localhost:${PORT}/api/health\n`);
});