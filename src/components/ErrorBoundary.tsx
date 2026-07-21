import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!);
      }
      return (
        <div className="flex flex-col items-center justify-center p-8 text-red-500">
          <h2 className="text-lg font-bold mb-2">渲染出错</h2>
          <pre className="text-xs whitespace-pre-wrap max-w-xl">{this.state.error?.message}</pre>
          <pre className="text-[10px] whitespace-pre-wrap max-w-xl mt-2 opacity-70">{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
