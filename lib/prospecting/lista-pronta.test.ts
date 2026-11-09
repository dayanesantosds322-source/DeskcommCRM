import { describe, expect, it } from "vitest";

import { McpAuthError, ensureScope } from "@/lib/mcp/auth";
import { allTools } from "@/lib/mcp/tools";
import { crmCreateProspectingListDraft } from "@/lib/mcp/tools/prospeccao-rascunho";
import { ACOES_ABERTAS_AO_TOKEN } from "@/lib/prospecting/acoes-do-token";
import {
  LIMITE_DA_LISTA,
  RASCUNHO_INSTRUCAO_KD,
  celularBrasileiro,
  decisaoDaJanela,
  prepararLista,
} from "@/lib/prospecting/lista-pronta";

function cemEmpresas() {
  return Array.from({ length: LIMITE_DA_LISTA }, (_, i) => ({
    nome: `Empresa ${String(i + 1).padStart(3, "0")}`,
    telefone: `+55929${String(10000000 + i)}`,
    fonte: `https://exemplo.local/fonte/${i + 1}`,
    segmento: "pizzaria",
    endereco: "Manaus",
  }));
}

describe("lista pronta", () => {
  it("aceita 100 celulares únicos e não marca WhatsApp nem consentimento", () => {
    const lista = prepararLista(cemEmpresas());
    expect(lista).toHaveLength(100);
    expect(new Set(lista.map((item) => item.telefone)).size).toBe(100);
    expect(new Set(lista.map((item) => item.nome)).size).toBe(100);
    expect(lista.every((item) => item.whatsappConfirmado === false)).toBe(true);
    expect(lista.every((item) => item.consentimento === "nao_coletado")).toBe(true);
  });

  it("recusa fixo, repetido e a 101ª empresa", () => {
    expect(celularBrasileiro("+559232221111")).toBeNull();
    expect(() =>
      prepararLista([
        { nome: "Uma Casa", telefone: "+5592991000001" },
        { nome: "Outra Casa", telefone: "+5592991000001" },
      ]),
    ).toThrow(/repetido/);
    expect(() => prepararLista([...cemEmpresas(), { nome: "Extra", telefone: "+5592990000000" }])).toThrow(
      /100/,
    );
  });

  it("a janela de 9 a 13 de novembro em Manaus espera, cabe e depois encerra", () => {
    const search = { janela: { inicio: "2026-11-09", fim: "2026-11-13", fuso: "America/Manaus" } };
    const antes = decisaoDaJanela(search, new Date("2026-11-09T03:59:00Z"));
    expect(antes.tipo).toBe("esperar");
    if (antes.tipo === "esperar") expect(antes.enviarEm.toISOString()).toBe("2026-11-09T13:00:00.000Z");
    expect(decisaoDaJanela(search, new Date("2026-11-09T13:00:00Z")).tipo).toBe("dentro");
    expect(decisaoDaJanela(search, new Date("2026-11-14T03:59:00Z")).tipo).toBe("dentro");
    expect(decisaoDaJanela(search, new Date("2026-11-14T04:00:00Z")).tipo).toBe("encerrada");
    expect(decisaoDaJanela({ niche: "mapas" }, new Date()).tipo).toBe("sem_janela");
  });

  it("o rascunho da KD fica no texto e não é publicação", () => {
    expect(RASCUNHO_INSTRUCAO_KD).toMatch(/sob encomenda/);
    expect(RASCUNHO_INSTRUCAO_KD).toMatch(/7 dias/);
    expect(RASCUNHO_INSTRUCAO_KD).toMatch(/3 dias/);
    expect(RASCUNHO_INSTRUCAO_KD).toMatch(/Jeferson/);
    expect(RASCUNHO_INSTRUCAO_KD).toMatch(/endereço/);
  });
});

describe("token e cartão", () => {
  it("token só de leitura não autoriza a ferramenta de rascunho", () => {
    expect(crmCreateProspectingListDraft.requiresScope).toBe("mcp:write");
    expect(allTools.find((tool) => tool.name === "crm_create_prospecting_list_draft")?.requiresScope).toBe(
      "mcp:write",
    );
    expect(() => ensureScope(["mcp:read"], "mcp:write")).toThrow(McpAuthError);
  });

  it("o token pode gravar a lista e não pode iniciar nem retomar", () => {
    expect(ACOES_ABERTAS_AO_TOKEN.has("seed_list")).toBe(true);
    expect(ACOES_ABERTAS_AO_TOKEN.has("start")).toBe(false);
    expect(ACOES_ABERTAS_AO_TOKEN.has("resume")).toBe(false);
  });
});
