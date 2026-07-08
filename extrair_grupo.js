const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// === CONFIGURAÇÃO DE MÚLTIPLOS ALVOS ===
// Adicione aqui quantos grupos quiser, separados por vírgula
const GRUPOS_ALVOS = [
    "AVALANCHE - Rede de Profissionais Intencionais",
    "NAVE SJC 🚀🧑‍🚀",
    "MORDOMIA Bíblica SJC"
];

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('⏳ Faça a leitura do QR Code abaixo para autenticar a sessão:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Sistema operante. Iniciando varredura multi-grupos...');

    try {
        const chats = await client.getChats();
        
        // Estrutura de memória para indexação e deduplicação: ID_SERIAL -> { celular, origens: [] }
        const dicionarioContatos = new Map();

        // FASE 1: Agregação e Isolamento de Contatos Únicos
        for (const nomeGrupo of GRUPOS_ALVOS) {
            const grupo = chats.find(c => c.isGroup && c.name === nomeGrupo);
            
            if (!grupo) {
                console.log(`⚠️ Aviso: O grupo "${nomeGrupo}" não foi localizado na memória. Pulando...`);
                continue;
            }

            console.log(`📦 Mapeando membros do grupo: ${grupo.name}`);

            for (const participante of grupo.participants) {
                let numStr = participante.id.user;

                // Filtro de Sanitização por Tamanho (E.164)
                if (numStr && numStr.length >= 7 && numStr.length <= 15) {
                    const idSerial = participante.id._serialized;

                    if (!dicionarioContatos.has(idSerial)) {
                        // Primeiro registro do contato
                        dicionarioContatos.set(idSerial, {
                            celular: numStr,
                            origens: [grupo.name]
                        });
                    } else {
                        // Contato repetido: Apenas adiciona a nova origem se ela já não constar ali
                        const registroExistente = dicionarioContatos.get(idSerial);
                        if (!registroExistente.origens.includes(grupo.name)) {
                            registroExistente.origens.push(grupo.name);
                        }
                    }
                }
            }
        }

        const totalContatosUnicos = dicionarioContatos.size;
        console.log(`\n📊 Agrupamento concluído: ${totalContatosUnicos} contatos únicos localizados.`);
        console.log(`⏳ Buscando nomes e etiquetas no banco de dados...\n`);

        let linhasCsv = ["Celular,Nome,Origem,Tags"];
        let contador = 0;

        // FASE 2: Resolução de Identidade e Tags (Apenas uma chamada por número único)
        for (const [idSerial, dados] of dicionarioContatos.entries()) {
            contador++;
            process.stdout.write(`\r🔄 Processando registro [${contador}/${totalContatosUnicos}]...`);

            try {
                const contato = await client.getContactById(idSerial);
                let nomeBruto = contato.pushname || contato.name || "Sem Nome";
                let nomeSanitizado = nomeBruto.replace(/"/g, '""');

                // Busca as Etiquetas (Labels) do WhatsApp Business
                let etiquetas = "";
                try {
                    const chatPrivado = await contato.getChat();
                    if (chatPrivado) {
                        const labels = await chatPrivado.getLabels();
                        if (labels && labels.length > 0) {
                            etiquetas = labels.map(l => l.name).join(', ');
                        }
                    }
                } catch (e) {
                    // Ignora falha de leitura de etiqueta
                }

                // Une as origens com ponto e vírgula para não quebrar as colunas do CSV
                let origensUnidas = dados.origens.join('; ');

                linhasCsv.push(`"${dados.celular}","${nomeSanitizado}","${origensUnidas}","${etiquetas}"`);

            } catch (erro) {
                // Fallback de segurança para o caso de falha de conexão em algum número específico
                let origensUnidas = dados.origens.join('; ');
                linhasCsv.push(`"${dados.celular}","Erro de Leitura","${origensUnidas}",""`);
            }
        }

        // FASE 3: Escrita do arquivo consolidado
        fs.writeFileSync('contatos_grupos_consolidados.csv', linhasCsv.join('\n'), 'utf8');
        console.log('\n\n📁 Arquivo "contatos_grupos_consolidados.csv" gerado com sucesso!');
        console.log('✅ Base de dados perfeitamente sanitizada e livre de duplicatas.');
        
        process.exit(0);

    } catch (erro) {
        console.error('\n❌ Falha crítica no motor de consolidação:', erro);
        process.exit(1);
    }
});

client.initialize();