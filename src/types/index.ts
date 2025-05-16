// 環境設定の型定義
export type EnvType = 'dev' | 'meta';

// 設定ファイルの型定義
export type ConfigType = {
    token: string;
    dev: {
        'sv-id': string;
        mysql: {
            host: string;
            port: string;
            user: string;
            password: string;
            database: string;
        }
        chroma: {
            host: string;
            port: string;
            collection: string;
        }
    };
    meta: {
        'sv-id': string;
        mysql: {
            host: string;
            port: string;
            user: string;
            password: string;
            database: string;
        }
        chroma: {
            host: string;
            port: string;
            collection: string;
        }
    };
};

// サーバーデータの型定義
export interface ServerData {
    serverName: string;
    channels: ChannelData[];
}

export interface ChannelData {
    name: string;
    id: string;
    messages: MessageData[];
    threads: ThreadData[];
}

export interface ThreadData {
    name: string;
    id: string;
    messages: MessageData[];
}

export interface MessageData {
    author: string;
    content: string;
    id: string;
    createdAt: Date;
} 