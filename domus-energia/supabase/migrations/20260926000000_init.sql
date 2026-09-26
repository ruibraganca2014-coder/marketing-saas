-- Domus Energia: esquema inicial

-- Aparelhos Tuya atribuídos a cada cliente.
-- Quem os adiciona é a empresa (no painel do Supabase ou com a service role), nunca o cliente.
create table public.aparelhos (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    device_id text not null,
    nome text,
    criado_em timestamptz not null default now(),
    unique (user_id, device_id)
);

alter table public.aparelhos enable row level security;

create policy "Cliente vê os seus aparelhos"
    on public.aparelhos for select
    to authenticated
    using (auth.uid() = user_id);

-- Pedidos de orçamento vindos do site público.
create table public.pedidos_orcamento (
    id bigint generated always as identity primary key,
    nome text not null check (char_length(nome) between 1 and 120),
    telefone text check (char_length(telefone) <= 30),
    email text check (char_length(email) <= 200),
    localidade text check (char_length(localidade) <= 120),
    servico text check (char_length(servico) <= 80),
    mensagem text check (char_length(mensagem) <= 2000),
    criado_em timestamptz not null default now()
);

alter table public.pedidos_orcamento enable row level security;

-- Qualquer visitante pode enviar um pedido, mas não pode ler os pedidos dos outros.
create policy "Qualquer pessoa pode pedir orçamento"
    on public.pedidos_orcamento for insert
    to anon, authenticated
    with check (true);
