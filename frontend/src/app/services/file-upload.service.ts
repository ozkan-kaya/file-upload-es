import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

interface FileInfo {
    filename: string;
    originalname?: string;
    size: number;
    uploadDate?: Date;
    path: string;
    mimetype?: string;
    score?: number;
    highlights?: {
        content?: string[];
        filename?: string[];
        originalname?: string[];
    };
}

interface UploadResponse {
    message: string;
    file: FileInfo & { contentLength?: number };
}

interface FilesResponse {
    files: FileInfo[];
    total?: number;
    query?: string;
}

@Injectable({
    providedIn: 'root'
})
export class FileUploadService {
    private apiUrl = `${environment.apiUrl}/api`;

    constructor(private http: HttpClient) { }

    uploadFile(file: File): Observable<UploadResponse> {
        const formData = new FormData();
        formData.append('file', file);

        return this.http.post<UploadResponse>(`${this.apiUrl}/upload`, formData);
    }

    getFiles(): Observable<FilesResponse> {
        return this.http.get<FilesResponse>(`${this.apiUrl}/files`);
    }

    searchFiles(query: string): Observable<FilesResponse> {
        return this.http.get<FilesResponse>(`${this.apiUrl}/search`, {
            params: { q: query }
        });
    }

    deleteFile(filename: string): Observable<{ message: string; filename: string }> {
        return this.http.delete<{ message: string; filename: string }>(`${this.apiUrl}/files/${filename}`);
    }

    getFileUrl(path: string): string {
        return `${environment.apiUrl}${path}`;
    }
}
