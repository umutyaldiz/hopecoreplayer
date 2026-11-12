import { DocumentPip, documentPipApi, type DocumentPipContext } from './DocumentPip';

export function installDocumentPip(ctx: DocumentPipContext): DocumentPip {
    return new DocumentPip(ctx);
}

export { DocumentPip, documentPipApi };
export type { DocumentPipContext };
