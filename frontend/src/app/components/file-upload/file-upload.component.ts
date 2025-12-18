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

        // Setup debounced search with backend Elasticsearch
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
            // Sonuçlar geldiğinde arama modunda olup olmadığımızı belirle
            this.isShowingSearchResults = !!(this.searchTerm && this.searchTerm.trim().length > 0);
        });
    }

    ngOnDestroy(): void {
        this.searchSubject.complete();
    }

    onSearchChange(searchTerm: string): void {
        this.searchSubject.next(searchTerm);
    }

    hasContentMatch(file: FileInfo): boolean {
        return !!(file.highlights && file.highlights.content && file.highlights.content.length > 0);
    }

    getHighlightSnippet(file: FileInfo): SafeHtml {
        if (file.highlights?.content && file.highlights.content.length > 0) {
            const processedHtml = this.processHighlights(file.highlights.content[0]);
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        return '';
    }

    getHighlightedFilename(file: FileInfo): SafeHtml {
        // Check if filename has highlights from Elasticsearch
        if (file.highlights?.filename && file.highlights.filename.length > 0) {
            const processedHtml = this.processHighlights(file.highlights.filename[0]);
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        if (file.highlights?.originalname && file.highlights.originalname.length > 0) {
            const processedHtml = this.processHighlights(file.highlights.originalname[0]);
            return this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
        // If no highlight, return plain originalname or filename
        return file.originalname || file.filename;
    }

    private processHighlights(html: string): string {
        if (!this.searchTerm || !this.searchTerm.trim()) return html;

        const term = this.searchTerm.trim().toLowerCase();
        // Elasticsearch highlights are inside <span class="highlight">...</span>
        return html.replace(/<span class="highlight">(.*?)<\/span>/g, (match, content) => {
            const highlightedText = content.replace(/<[^>]*>/g, '').trim().toLowerCase();

            // Sadece birebir kelime eşleşmesi durumunda sarı (original highlight) kalsın
            if (highlightedText === term) {
                return match;
            }

            // Eğer aranan terim vurgulanan metnin sadece bir parçasıysa (örn: "jun" -> "june") 
            // veya yazım hatası toleransı ile gelmişse mavimsi (fuzzy) yap
            return match.replace('class="highlight"', 'class="highlight-fuzzy"');
        });
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

                // Clear message after 5 seconds with fade out
                setTimeout(() => {
                    this.isFading = true;
                    setTimeout(() => {
                        this.uploadMessage = '';
                        this.isFading = false;
                    }, 1000); // 1s matches fadeOut animation duration
                }, 4000);
            },
            error: (error) => {
                console.error('Upload error:', error);
                const errorMsg = error.error?.error || 'Dosya yüklenirken hata oluştu';
                this.uploadMessage = errorMsg;
                this.uploadProgress = false;

                // Clear error after 5 seconds with fade out
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

                    // Clear message after 5 seconds with fade out
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

                    // Clear error after 5 seconds with fade out
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
