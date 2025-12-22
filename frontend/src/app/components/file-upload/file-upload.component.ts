import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FileUploadService } from '../../services/file-upload.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

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
        'content.exact'?: string[];
        filename?: string[];
        originalname?: string[];
    };
}

@Component({
    selector: 'app-file-upload',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './file-upload.component.html',
    styleUrls: ['./file-upload.component.css']
})
export class FileUploadComponent implements OnInit, OnDestroy {
    selectedFile: File | null = null;
    uploadProgress: boolean = false;
    uploadMessage: string = '';
    files: FileInfo[] = [];
    filteredFiles: FileInfo[] = [];
    searchTerm: string = '';
    isFading: boolean = false;
    isShowingSearchResults: boolean = false;
    private searchSubject = new Subject<string>();

    constructor(
        private fileUploadService: FileUploadService,
        private sanitizer: DomSanitizer
    ) { }

    ngOnInit(): void {
        this.loadFiles();

        // Debounced search with Elasticsearch backend
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(searchTerm => {
                if (!searchTerm || !searchTerm.trim()) {
                    return this.fileUploadService.getFiles();
                }
                return this.fileUploadService.searchFiles(searchTerm);
            })
        ).subscribe(response => {
            this.filteredFiles = response.files;
            this.isShowingSearchResults = !!(this.searchTerm && this.searchTerm.trim().length > 0);
        });
    }

    ngOnDestroy(): void {
        this.searchSubject.complete();
    }

    onSearchChange(searchTerm: string): void {
        this.searchSubject.next(searchTerm);
    }

    // Check if file has content matches (not just filename matches)
    hasContentMatch(file: FileInfo): boolean {
        return !!(file.highlights && (
            (file.highlights.content && file.highlights.content.length > 0) ||
            (file.highlights['content.exact'] && file.highlights['content.exact'].length > 0)
        ));
    }

    // Get highlighted content snippets, joined with "..."
    getHighlightSnippet(file: FileInfo): SafeHtml {
        if (file.highlights?.['content.exact'] && file.highlights['content.exact'].length > 0) {
            const processedHtml = file.highlights['content.exact']
                .map(h => this.processHighlights(h))
                .join(' ... ');
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        if (file.highlights?.content && file.highlights.content.length > 0) {
            const processedHtml = file.highlights.content
                .map(h => this.processHighlights(h))
                .join(' ... ');
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        return '';
    }

    // Get highlighted filename or fallback to plain name
    getHighlightedFilename(file: FileInfo): SafeHtml {
        if (file.highlights?.filename && file.highlights.filename.length > 0) {
            const processedHtml = this.processHighlights(file.highlights.filename[0]);
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        if (file.highlights?.originalname && file.highlights.originalname.length > 0) {
            const processedHtml = this.processHighlights(file.highlights.originalname[0]);
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        return file.originalname || file.filename;
    }

    /**
     * Process highlight HTML with custom coloring:
     * - Yellow (highlight): Exact phrase/term matches
     * - Blue (highlight-fuzzy): Fuzzy/Approximate matches
     * 
     * Simplified logic: We trust Elasticsearch returned highlights in <span class="highlight">.
     * We just check if the content inside is an exact query term match.
     */
    private processHighlights(html: string): string {
        if (!this.searchTerm || !this.searchTerm.trim() || !html) return html;

        const term = this.searchTerm.trim().toLowerCase();
        // Split query into terms for strict token matching
        const terms = term.split(/\s+/).filter(t => t.length > 0);

        // Replace <span class="highlight"> based on content exactness
        return html.replace(/<span class="highlight">(.*?)<\/span>/gi, (match, content) => {
            const lowerContent = content.toLowerCase();

            // Check if content matches any query term exactly OR matches the full query phrase
            const isExact = terms.some(t => t === lowerContent) || term === lowerContent;

            if (isExact) {
                return `<span class="highlight">${content}</span>`;
            } else {
                return `<span class="highlight-fuzzy">${content}</span>`;
            }
        });
    }

    // Escape special regex characters
    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    onFileSelected(event: any): void {
        const file = event.target.files[0];
        if (file) {
            this.selectedFile = file;
            this.uploadMessage = '';
        }
    }

    onUpload(): void {
        if (!this.selectedFile) {
            this.uploadMessage = 'Lütfen bir dosya seçin';
            return;
        }

        this.uploadProgress = true;
        this.uploadMessage = '';

        this.fileUploadService.uploadFile(this.selectedFile).subscribe({
            next: (response) => {
                this.uploadMessage = response.message;
                this.selectedFile = null;
                this.uploadProgress = false;
                this.loadFiles();

                // Reset file input
                const fileInput = document.getElementById('fileInput') as HTMLInputElement;
                if (fileInput) {
                    fileInput.value = '';
                }

                // Fade out message after delay
                setTimeout(() => {
                    this.isFading = true;
                    setTimeout(() => {
                        this.uploadMessage = '';
                        this.isFading = false;
                    }, 1000);
                }, 4000);
            },
            error: (error) => {
                console.error('Upload error:', error);
                const errorMsg = error.error?.error || 'Dosya yüklenirken hata oluştu';
                this.uploadMessage = errorMsg;
                this.uploadProgress = false;

                setTimeout(() => {
                    this.isFading = true;
                    setTimeout(() => {
                        this.uploadMessage = '';
                        this.isFading = false;
                    }, 1000);
                }, 4000);
            }
        });
    }

    loadFiles(): void {
        this.fileUploadService.getFiles().subscribe({
            next: (response) => {
                this.files = response.files;
                this.filteredFiles = response.files;
                this.isShowingSearchResults = false;
            },
            error: (error) => {
                console.error('Load files error:', error);
            }
        });
    }

    // Get Font Awesome icon class based on file type
    getFileIcon(mimetype: string | undefined): string {
        if (!mimetype) return 'fa-file-alt';

        if (mimetype.includes('pdf')) {
            return 'fa-file-pdf has-text-danger';
        } else if (mimetype.includes('word') || mimetype.includes('msword')) {
            return 'fa-file-word has-text-link';
        } else if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) {
            return 'fa-file-excel has-text-success';
        }

        return 'fa-file-alt';
    }

    getFileUrl(path: string): string {
        return this.fileUploadService.getFileUrl(path);
    }

    formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    deleteFile(file: FileInfo): void {
        const displayName = file.originalname || file.filename;
        const confirmMessage = `"${displayName}" dosyasını silmek istediğinizden emin misiniz?`;

        if (confirm(confirmMessage)) {
            this.fileUploadService.deleteFile(file.filename).subscribe({
                next: (response) => {
                    this.uploadMessage = response.message;
                    this.loadFiles();

                    setTimeout(() => {
                        this.isFading = true;
                        setTimeout(() => {
                            this.uploadMessage = '';
                            this.isFading = false;
                        }, 1000);
                    }, 4000);
                },
                error: (error) => {
                    console.error('Delete error:', error);
                    const errorMsg = error.error?.error || 'Dosya silinirken hata oluştu';
                    this.uploadMessage = errorMsg;

                    setTimeout(() => {
                        this.isFading = true;
                        setTimeout(() => {
                            this.uploadMessage = '';
                            this.isFading = false;
                        }, 1000);
                    }, 4000);
                }
            });
        }
    }

    formatDate(date: Date | undefined): string {
        if (!date) return '';
        return new Date(date).toLocaleString('tr-TR');
    }
}
