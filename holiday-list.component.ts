// ai-chatbot.component.ts
import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { DatabaseService } from 'src/_services/DatabaseService';
import { Router } from '@angular/router';

interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'bot';
  timestamp?: Date;
  sqlQuery?: string;
  data?: any[];
  displayType?: 'text' | 'table' | 'count' | 'summary';
  tableHeaders?: string[];
  tableData?: any[][];
  count?: number;
  rawData?: any[]; // Store raw data for export
}

@Component({
  selector: 'app-holiday-list',
  templateUrl: './holiday-list.component.html',
  styleUrls: ['./holiday-list.component.scss']
})
export class HolidayListComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  messages: Message[] = [];
  userMessage: string = '';
  predefinedQuestions: string[] = [];
  isLoading: boolean = false;
  private shouldAutoScroll: boolean = true;
  exportInProgress: { [key: number]: boolean } = {};
  showSQL: { [key: number]: boolean } = {};
  private readonly STORAGE_KEY = 'ai_chatbot_messages';
  constructor(
    private http: HttpClient, 
    private sanitizer: DomSanitizer,
    private service: DatabaseService, // Replace 'any' with your actual service type
    private rout: Router // Your router service
  ) {}

  ngOnInit(): void {
    // Initialize predefined questions based on your system
    this.predefinedQuestions = [
      'Show all active users',
      'Count users by state', 
      'Show sales users in Haryana',
      'List users created in last 30 days',
      'Show user hierarchy'
    ];
    
    // Load messages from localStorage
    this.loadMessagesFromStorage();
    
    // If no saved messages, add welcome message
    if (this.messages.length === 0) {
      const welcomeMessage: Message = {
        text: 'Hello! I can help you query your database using natural language. What would you like to know?',
        formattedText: this.formatText('Hello! I can help you query your database using natural language. What would you like to know?'),
        sender: 'bot',
        timestamp: new Date()
      };
      this.messages.push(welcomeMessage);
      this.saveMessagesToStorage();
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }

  private loadMessagesFromStorage(): void {
    try {
      const savedMessages = localStorage.getItem(this.STORAGE_KEY);
      if (savedMessages) {
        const parsedMessages = JSON.parse(savedMessages);
        // Reconstruct messages with proper Date objects and SafeHtml
        this.messages = parsedMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          formattedText: msg.formattedText ? this.sanitizer.bypassSecurityTrustHtml(msg.formattedTextString || msg.text) : this.formatText(msg.text)
        }));
      }
    } catch (error) {
      console.error('Error loading messages from storage:', error);
      this.messages = [];
    }
  }

  private saveMessagesToStorage(): void {
    try {
      // Convert messages to a format that can be stored in localStorage
      const messagesToStore = this.messages.map(msg => ({
        ...msg,
        formattedTextString: msg.formattedText ? this.getHtmlString(msg.formattedText) : null,
        formattedText: undefined // Remove SafeHtml object before storing
      }));
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(messagesToStore));
    } catch (error) {
      console.error('Error saving messages to storage:', error);
      // If storage is full or there's an error, you might want to clear old messages
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.clearOldMessages();
      }
    }
  }

  private getHtmlString(safeHtml: SafeHtml): string {
    // This is a workaround to get the HTML string from SafeHtml
    const div = document.createElement('div');
    div.innerHTML = safeHtml as string;
    return div.innerHTML;
  }

  private clearOldMessages(): void {
    // Keep only the last 50 messages if storage is full
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
      this.saveMessagesToStorage();
    }
  }

  clearChatHistory(): void {
    // Clear messages from memory
    this.messages = [];
    
    // Clear localStorage
    localStorage.removeItem(this.STORAGE_KEY);
    
    // Add welcome message back
    const welcomeMessage: Message = {
      text: 'Chat history cleared. How can I help you today?',
      formattedText: this.formatText('Chat history cleared. How can I help you today?'),
      sender: 'bot',
      timestamp: new Date()
    };
    this.messages.push(welcomeMessage);
    this.saveMessagesToStorage();
    
    // Reset other states
    this.exportInProgress = {};
    this.showSQL = {};
    this.shouldAutoScroll = true;
  }

  sendMessage(userMessage?: string): void {
    const messageText = userMessage || this.userMessage;
    
    if (!messageText.trim()) return;

    // Add user message
    this.messages.push({
      text: messageText,
      formattedText: this.formatText(messageText),
      sender: 'user',
      timestamp: new Date()
    });

    // Save to localStorage after adding user message
    this.saveMessagesToStorage();

    this.userMessage = '';
    this.isLoading = true;
    
    // Enable auto-scroll when sending a new message
    this.shouldAutoScroll = true;

    // Call your backend API
    this.processNaturalLanguageQuery(messageText);
  }

  private processNaturalLanguageQuery(query: string): void {
    const payload = {
      filter: query
    };
    
    this.service.post_rqst(payload, "Enquiry/HelloWorld").subscribe(
      (result) => {
        this.isLoading = false;
        
        if (result['success'] === true) {
          const message: Message = {
            text: '',
            formattedText: this.sanitizer.bypassSecurityTrustHtml(''),
            sender: 'bot',
            timestamp: new Date(),
            sqlQuery: result['sql'],
            rawData: result['data']
          };
          
          // Check if we have data array with results
          if (result['data'] && Array.isArray(result['data']) && result['data'].length > 0) {
            message.displayType = 'table';
            message.count = result['count'] || result['data'].length;
            this.buildDynamicTable(result['data'], message);
            message.text = `Found ${message.count} result${message.count !== 1 ? 's' : ''} for your query.`;
          }
          // Only count returned
          else if (result['count'] !== undefined && (!result['data'] || result['data'].length === 0)) {
            message.displayType = 'count';
            message.count = result['count'];
            message.text = `The count for your query is: ${result['count']}`;
            message.formattedText = this.buildCountDisplay(result, query);
          }
          // Summary data
          else if (result['summary']) {
            message.displayType = 'summary';
            message.formattedText = this.buildSummaryDisplay(result['summary']);
            message.text = 'Here\'s a summary of the results';
          }
          // No results
          else {
            message.displayType = 'text';
            message.text = 'No matching records found for your query.';
            message.formattedText = this.formatText(message.text);
          }
          
          this.messages.push(message);
          
          // Save to localStorage after adding bot message
          this.saveMessagesToStorage();
        } else {
          // Handle error response
          const errorMsg = result['error'] || result['statusMsg'] || 'I couldn\'t process that query. Please try rephrasing it.';
          this.messages.push({
            text: errorMsg,
            formattedText: this.formatText(errorMsg),
            sender: 'bot',
            timestamp: new Date()
          });
          
          // Save to localStorage
          this.saveMessagesToStorage();
        }
        
        this.shouldAutoScroll = true;
      },
      (error) => {
        console.error('Query error:', error);
        this.isLoading = false;
        
        const errorMsg = 'I\'m experiencing technical difficulties. Please try again later.';
        this.messages.push({
          text: errorMsg,
          formattedText: this.formatText(errorMsg),
          sender: 'bot',
          timestamp: new Date()
        });
        
        // Save to localStorage
        this.saveMessagesToStorage();
        
        this.shouldAutoScroll = true;
      }
    );
  }

  buildDynamicTable(data: any[], message: Message): void {
    if (!data || data.length === 0) return;
    
    // Extract headers from first object keys
    const firstRow = data[0];
    message.tableHeaders = Object.keys(firstRow);
    
    // Build table data array
    message.tableData = data.map(row => {
      return message.tableHeaders!.map(header => {
        const value = row[header];
        return this.formatCellValue(value, header);
      });
    });
  }

  formatCellValue(value: any, columnName: string): any {
    // Handle null/undefined/empty
    if (value === null || value === undefined || value === '') {
      return { value: '---', type: 'empty' };
    }
    
    // Handle dates
    if (columnName.toLowerCase().includes('date') || columnName.toLowerCase().includes('time')) {
      if (value === '0000-00-00' || value === '0000-00-00 00:00:00') {
        return { value: '---', type: 'empty' };
      }
      return { value: value, type: 'date' };
    }
    
    // Handle status
    if (columnName.toLowerCase() === 'status') {
      return { 
        value: value == '1' ? 'Active' : 'Inactive', 
        type: 'status',
        statusClass: value == '1' ? 'active' : 'inactive'
      };
    }
    
    // Handle flags
    if (columnName.toLowerCase().includes('flag')) {
      return { 
        value: value == '1' ? 'Yes' : 'No', 
        type: 'flag',
        flagClass: value == '1' ? 'enabled' : 'disabled'
      };
    }
    
    // Handle ID columns (make them clickable if it's the main ID)
    if (columnName.toLowerCase() === 'id') {
      return { value: value, type: 'id', clickable: true };
    }
    
    // Handle name columns (make them clickable)
    if (columnName.toLowerCase() === 'name') {
      return { value: value, type: 'name', clickable: true };
    }
    
    // Default
    return { value: value.toString(), type: 'text' };
  }

  formatHeaderName(header: string): string {
    // Convert snake_case or camelCase to readable format
    return header
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  buildCountDisplay(result: any, query: string): SafeHtml {
    const html = `
      <div class="count-result-card">
        <div class="query-info">
          <label>Query:</label>
          <p>${query}</p>
        </div>
        <div class="count-display">
          <span class="count-number">${result['count']}</span>
          <span class="count-label">Records Found</span>
        </div>
        ${result['sql'] ? `
          <div class="sql-info-box">
            <label>Generated SQL:</label>
            <code>${this.escapeHtml(result['sql'])}</code>
          </div>
        ` : ''}
      </div>
    `;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  buildSummaryDisplay(summary: any): SafeHtml {
    let html = '<div class="summary-display">';
    
    if (typeof summary === 'string') {
      html += summary;
    } else {
      // If summary is an object, display it as key-value pairs
      Object.keys(summary).forEach(key => {
        html += `
          <div class="summary-item">
            <label>${this.formatHeaderName(key)}:</label>
            <span>${summary[key]}</span>
          </div>
        `;
      });
    }
    
    html += '</div>';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  onCellClick(messageIndex: number, rowIndex: number, colIndex: number): void {
    const message = this.messages[messageIndex];
    if (!message.rawData || !message.tableHeaders) return;
    
    const header = message.tableHeaders[colIndex];
    const row = message.rawData[rowIndex];
    
    // If clicking on ID or Name column, navigate to detail
    if (header.toLowerCase() === 'id' || header.toLowerCase() === 'name') {
      const userId = row['id'];
      if (userId) {
        this.rout.navigate(['/sale-user-detail/' + userId]);
      }
    }
  }

  exportToExcel(messageIndex: number): void {
    const message = this.messages[messageIndex];
    
    if (!message.rawData || message.rawData.length === 0) {
      return;
    }
    
    this.exportInProgress[messageIndex] = true;
    
    try {
      // Prepare data for export
      const exportData = this.prepareExportData(message);
      
      // Create a new workbook
      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      const colWidths = this.calculateColumnWidths(exportData);
      ws['!cols'] = colWidths;
      
      // Create workbook and add worksheet
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Query Results');
      
      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `chat_query_results_${timestamp}.xlsx`;
      
      // Write file
      const excelBuffer: any = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      this.saveAsExcelFile(excelBuffer, filename);
      
      this.exportInProgress[messageIndex] = false;
    } catch (error) {
      console.error('Export failed:', error);
      this.exportInProgress[messageIndex] = false;
    }
  }

  prepareExportData(message: Message): any[] {
    const exportData = [];
    
    if (!message.rawData || !message.tableHeaders) return [];
    
    for (const row of message.rawData) {
      const exportRow: { [key: string]: any } = {};
      
      for (const header of message.tableHeaders) {
        let value = row[header];
        
        // Format values for export
        if (value === null || value === undefined || value === '') {
          value = '';
        } else if (header.toLowerCase() === 'status') {
          value = value == '1' ? 'Active' : 'Inactive';
        } else if (header.toLowerCase().includes('flag')) {
          value = value == '1' ? 'Yes' : 'No';
        } else if ((header.toLowerCase().includes('date') || header.toLowerCase().includes('time')) 
                   && value !== '0000-00-00' && value !== '0000-00-00 00:00:00') {
          // Keep date as is for Excel to recognize
          value = value;
        } else if (value === '0000-00-00' || value === '0000-00-00 00:00:00') {
          value = '';
        }
        
        // Use formatted header name for export
        exportRow[this.formatHeaderName(header)] = value;
      }
      
      exportData.push(exportRow);
    }
    
    return exportData;
  }

  calculateColumnWidths(data: any[]): any[] {
    if (data.length === 0) return [];
    
    const headers = Object.keys(data[0]);
    const widths = headers.map(header => {
      // Calculate max width for each column
      let maxWidth = header.length;
      
      data.forEach(row => {
        const value = row[header];
        if (value) {
          const length = value.toString().length;
          if (length > maxWidth) {
            maxWidth = length;
          }
        }
      });
      
      // Add some padding and set min/max widths
      return { wch: Math.min(Math.max(maxWidth + 2, 10), 50) };
    });
    
    return widths;
  }

  saveAsExcelFile(buffer: any, fileName: string): void {
    const data: Blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' 
    });
    saveAs(data, fileName);
  }

  toggleSQL(messageIndex: number): void {
    this.showSQL[messageIndex] = !this.showSQL[messageIndex];
  }

  // Format text to handle line breaks and basic markdown
  private formatText(text: string): SafeHtml {
    let formattedText = text
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\* (.*?)(<br>|$)/gm, '<li>$1</li>')
      .replace(/(<li>.*?<\/li>)(?:\s*<li>.*?<\/li>)*/g, (match) => {
        return '<ul>' + match + '</ul>';
      })
      .replace(/^\d+\.\s+(.*?)(<br>|$)/gm, '<li>$1</li>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    return this.sanitizer.bypassSecurityTrustHtml(formattedText);
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  onScroll(event: any): void {
    const element = event.target;
    const threshold = 150; 
    const position = element.scrollTop + element.offsetHeight;
    const height = element.scrollHeight;
    
    this.shouldAutoScroll = (height - position) < threshold;
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop = 
          this.messagesContainer.nativeElement.scrollHeight;
        
        setTimeout(() => {
          this.shouldAutoScroll = false;
        }, 100);
      }
    } catch (err) {
      console.error('Scroll error:', err);
    }
  }

  sendPredefinedQuestion(question: string): void {
    this.sendMessage(question);
  }

  back(): void {
    window.history.back();
  }
}