import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RASCUNHO_INSTRUCAO_KD } from "@/lib/prospecting/lista-pronta";
import { criarRascunhoDeLista } from "@/lib/prospecting/rascunho-de-lista";

const ORG = "11111111-1111-4111-8111-111111111111";
const PEDIDO_ID = "22222222-2222-4222-8222-222222222222";

function empresas(qtd = 2) {
  return Array.from({ length: qtd }, (_, i) => ({
    nome: `Casa ${i + 1}`,
    telefone: `+55929${String(20000000 + i)}`,
  }));
}

function poolCom(existente: { id: string; status: string } | null) {
  const sqls: string[] = [];
  const client = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) return { rows: [] };
      if (sql.startsWith("select id, status, search_status")) return { rows: existente ? [existente] : [] };
      if (sql.startsWith("insert into prospecting_campaigns")) {
        return { rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
      }
      if (sql.startsWith("insert into prospecting_candidates")) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  return {
    sqls,
    pool: { connect: async () => client } as never,
  };
}

const pedido = {
  requestId: PEDIDO_ID,
  nome: "Lista 9 a 13",
  empresas: empresas(),
  ritmo: { daily_limit: 20, interval_minutes: 15 },
  janela: { inicio: "2026-11-09", fim: "2026-11-13", fuso: "America/Manaus" },
  instrucao: RASCUNHO_INSTRUCAO_KD,
  agenteId: null,
};

describe("criarRascunhoDeLista", () => {
  it("grava rascunho sem running e sem mensagem, no ritmo de 20 por dia", async () => {
    const banco = poolCom(null);
    const resultado = await criarRascunhoDeLista(banco.pool, ORG, pedido);
    expect(resultado).toMatchObject({
      status: "draft",
      search_status: "succeeded",
      envio: false,
      disparo: "aguardando_cartao",
      inseridos: 2,
      ja_existia: false,
    });
    const texto = banco.sqls.join("\n");
    expect(texto).toContain("'draft','succeeded'");
    expect(texto).not.toMatch(/insert into messages/);
    expect(texto).not.toContain("status='running'");
    const insert = banco.sqls.find((sql) => sql.startsWith("insert into prospecting_campaigns"));
    expect(insert).toBeTruthy();
  });

  it("o mesmo request_id não grava de novo", async () => {
    const banco = poolCom({ id: "33333333-3333-4333-8333-333333333333", status: "draft" });
    const resultado = await criarRascunhoDeLista(banco.pool, ORG, pedido);
    expect(resultado.ja_existia).toBe(true);
    expect(resultado.inseridos).toBe(0);
    expect(banco.sqls.some((sql) => sql.startsWith("insert into prospecting_"))).toBe(false);
  });

  it("o worker e o início consultam a janela antes de qualquer envio", () => {
    const worker = readFileSync(join(process.cwd(), "lib/prospecting/worker.ts"), "utf8");
    const envio = worker.indexOf("sendMessageHandler(");
    const janela = worker.indexOf("decisaoDaJanela(");
    expect(janela).toBeGreaterThan(-1);
    expect(janela).toBeLessThan(envio);
    const inicio = readFileSync(join(process.cwd(), "lib/prospecting/store.ts"), "utf8");
    expect(inicio).toContain("A janela desta lista já terminou. Nada foi enviado.");
  });
});
