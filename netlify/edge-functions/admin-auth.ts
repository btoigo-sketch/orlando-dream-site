// Protege a área administrativa (/admin.html) com usuário e senha (HTTP Basic).
//
// As credenciais NÃO ficam no código. Vêm das variáveis de ambiente do Netlify:
//   ADMIN_USER       -> nome de usuário
//   ADMIN_PASS_HASH  -> valor gerado por gerar_hash_senha.py (formato: pbkdf2$iterações$salt$hash)
//
// Se alguma variável faltar, a área fica BLOQUEADA (nunca liberada).
import type { Config, Context } from "@netlify/edge-functions";

const enc = new TextEncoder();

function daBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Comparação em tempo constante (não vaza, pelo tempo, quantos caracteres acertaram).
function iguais(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function verificarSenha(senha: string, registro: string): Promise<boolean> {
  const [alg, iter, salt, hash] = registro.split("$");
  if (alg !== "pbkdf2") return false;
  const iteracoes = Number(iter);
  // Teto de 200 mil: acima disso estouraria o limite de CPU das Edge Functions.
  if (!Number.isInteger(iteracoes) || iteracoes < 1000 || iteracoes > 200_000) return false;
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const derivado = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: daBase64(salt), iterations: iteracoes },
      chave,
      256,
    ),
  );
  return iguais(derivado, daBase64(hash));
}

const naoAutorizado = () =>
  new Response("Acesso restrito. Informe usuário e senha.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Admin Orlando Dream", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });

export default async (request: Request, context: Context) => {
  const usuarioEsperado = Netlify.env.get("ADMIN_USER");
  const registro = Netlify.env.get("ADMIN_PASS_HASH");

  // Falha fechada: sem configuração, ninguém entra.
  if (!usuarioEsperado || !registro) {
    return new Response("Área administrativa não configurada.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const cabecalho = request.headers.get("authorization") ?? "";
  if (!cabecalho.toLowerCase().startsWith("basic ")) return naoAutorizado(); // 1º acesso: só pede o login

  let usuario = "";
  let senha = "";
  try {
    const texto = new TextDecoder().decode(daBase64(cabecalho.slice(6).trim()));
    const i = texto.indexOf(":");
    if (i >= 0) {
      usuario = texto.slice(0, i);
      senha = texto.slice(i + 1);
    }
  } catch { /* cabeçalho inválido: segue com vazio e falha abaixo */ }

  // As duas verificações sempre rodam (tempo parecido para usuário certo ou errado).
  let senhaOk = false;
  try {
    senhaOk = await verificarSenha(senha, registro);
  } catch {
    senhaOk = false;
  }
  const usuarioOk = iguais(enc.encode(usuario), enc.encode(usuarioEsperado));

  if (usuarioOk && senhaOk) {
    const resposta = await context.next();
    resposta.headers.set("Cache-Control", "private, no-store");
    return resposta;
  }

  await new Promise((r) => setTimeout(r, 1000)); // freia tentativas repetidas
  return naoAutorizado();
};

export const config: Config = { path: ["/admin", "/admin/*", "/admin.html"] };
