# Contributing to ShelbyFlix

First off, thank you for considering contributing to ShelbyFlix! 🎉

This document provides guidelines for contributing to the project. Following these guidelines helps maintain code quality and makes the review process smoother for everyone.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)

---

## 🤝 Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please be respectful and constructive in all interactions.

**Key principles:**
- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on what's best for the community
- Show empathy towards other community members

---

## 💡 How Can I Contribute?

### Reporting Bugs 🐛

Before creating a bug report, please:
1. **Search existing issues** to avoid duplicates
2. **Use the latest version** to ensure the bug hasn't been fixed
3. **Collect information** about the bug:
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots or error messages
   - Environment details (OS, browser, Node version)

**Submit bugs via:** [GitHub Issues](https://github.com/Legendarytunzeverywhere/shelbyflix/issues/new)

**Bug report template:**
```markdown
## Bug Description
A clear description of the bug.

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. See error

## Expected Behavior
What should happen?

## Actual Behavior
What actually happened?

## Environment
- OS: [e.g., Windows 11, macOS 14]
- Browser: [e.g., Chrome 120, Firefox 121]
- Node.js: [e.g., v18.17.0]
- Next.js: [e.g., 15.5.18]

## Additional Context
Add any other context, screenshots, or logs.
```

---

### Suggesting Features 💡

Feature suggestions are welcome! Before submitting:
1. **Check if the feature already exists** or is planned
2. **Explain the problem** your feature would solve
3. **Describe the solution** you'd like to see

**Submit features via:** [GitHub Discussions](https://github.com/Legendarytunzeverywhere/shelbyflix/discussions)

---

### Contributing Code 💻

We accept pull requests for:
- Bug fixes
- New features
- Performance improvements
- Documentation improvements
- Test coverage improvements

---

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+ and npm
- Git
- Aptos wallet (Petra recommended)
- Supabase account
- Shelby API key

### Setup Steps

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then:
   git clone https://github.com/your-username/shelbyflix.git
   cd shelbyflix
   ```

2. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/Legendarytunzeverywhere/shelbyflix.git
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

5. **Run development server**
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)

6. **Run tests**
   ```bash
   npm run test
   ```

---

## 📝 Coding Standards

### TypeScript

- **Use TypeScript** for all new code
- **Enable strict mode** (already configured)
- **Define types explicitly** - avoid `any` when possible
- **Use interfaces** for object shapes
- **Export types** when they're used in multiple files

**Good:**
```typescript
interface VideoMetadata {
  videoId: string;
  title: string;
  uploader: string;
}

function processVideo(metadata: VideoMetadata): void {
  // ...
}
```

**Bad:**
```typescript
function processVideo(metadata: any) {
  // ...
}
```

---

### Code Style

We use **ESLint** and **Prettier** for consistent formatting.

**Before committing, run:**
```bash
npm run lint
npm run format  # If you have Prettier configured
```

**General guidelines:**
- Use **2 spaces** for indentation
- Use **single quotes** for strings
- Add **semicolons** at the end of statements
- Use **camelCase** for variables and functions
- Use **PascalCase** for components and types
- Use **UPPER_CASE** for constants

---

### Component Structure

**React components should follow this structure:**

```typescript
'use client'; // If client component

import { useState } from 'react';
import { SomeType } from '@/types';

// Props interface
interface MyComponentProps {
  title: string;
  onSubmit: (data: SomeType) => void;
}

// Component
export default function MyComponent({ title, onSubmit }: MyComponentProps) {
  const [state, setState] = useState<string>('');
  
  // Event handlers
  const handleClick = () => {
    // ...
  };
  
  // Render
  return (
    <div>
      <h1>{title}</h1>
    </div>
  );
}
```

---

### File Organization

```
shelbyflix/
├── app/                    # Next.js pages (App Router)
├── components/             # Reusable React components
├── lib/                    # Core business logic
│   ├── shelby.ts          # Shelby-specific code
│   ├── supabase.ts        # Database code
│   └── utils.ts           # Generic utilities
├── types/                  # TypeScript type definitions
├── hooks/                  # Custom React hooks
└── public/                 # Static assets
```

**Naming conventions:**
- Components: `PascalCase.tsx` (e.g., `VideoPlayer.tsx`)
- Utilities: `kebab-case.ts` (e.g., `video-service.ts`)
- Types: `PascalCase` (e.g., `VideoMetadata`)
- Hooks: `useCamelCase` (e.g., `useWallet`)

---

## 📋 Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) for clear commit history.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, no logic changes)
- **refactor:** Code refactoring (no feature changes)
- **perf:** Performance improvements
- **test:** Adding or updating tests
- **chore:** Build process or tooling changes

### Examples

```bash
# Feature
feat(upload): add support for WebM video format

# Bug fix
fix(player): resolve playback issue on Safari

# Documentation
docs(readme): add installation instructions

# Refactor
refactor(shelby): simplify blob upload logic
```

---

## 🔄 Pull Request Process

### Before Submitting

1. ✅ **Sync with upstream**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. ✅ **Run tests**
   ```bash
   npm run test
   npm run lint
   ```

3. ✅ **Update documentation** if needed

4. ✅ **Test your changes** manually

### Submitting the PR

1. **Push to your fork**
   ```bash
   git push origin feature/my-feature
   ```

2. **Open a Pull Request** on GitHub

3. **Fill out the PR template:**
   - What does this PR do?
   - Related issue(s)
   - How to test
   - Screenshots (if UI changes)
   - Checklist

4. **Wait for review**
   - Maintainers will review your PR
   - Address feedback if requested
   - Be patient and respectful

### PR Title Format

Use the same format as commit messages:
```
feat(upload): add support for WebM video format
```

### PR Template

```markdown
## Description
Brief description of what this PR does.

## Related Issues
Fixes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## How to Test
1. Step 1
2. Step 2
3. Expected result

## Screenshots
(If applicable)

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review
- [ ] I have commented complex code
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix/feature works
- [ ] All tests pass locally
```

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm run test

# Watch mode (during development)
npm run test:watch

# Run specific test file
npm run test -- video-service.test.ts
```

### Writing Tests

We use **Vitest** for testing.

**Example test:**
```typescript
import { describe, it, expect } from 'vitest';
import { validateTitle } from '@/lib/validation';

describe('validateTitle', () => {
  it('should accept valid titles', () => {
    const result = validateTitle('My Video Title');
    expect(result.valid).toBe(true);
  });
  
  it('should reject empty titles', () => {
    const result = validateTitle('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });
});
```

**Testing guidelines:**
- Write tests for new features
- Update tests when fixing bugs
- Aim for meaningful test coverage, not just high numbers
- Test edge cases and error conditions

---

## 📚 Documentation

### Code Comments

**When to comment:**
- Complex algorithms or business logic
- Non-obvious decisions or workarounds
- Security-sensitive code
- Public API functions

**What NOT to comment:**
- Self-explanatory code
- What the code does (the code itself should be clear)

**Good:**
```typescript
// Move contract requires microseconds, so convert from milliseconds
const unlockTimeMicros = msToMicros(unlockAt);
```

**Bad:**
```typescript
// Set the title
setTitle(newTitle);
```

---

### Documentation Files

When adding features, update relevant documentation:

- **README.md** - User-facing features, setup instructions
- **ARCHITECTURE.md** - Architecture decisions, system design
- **DATA_FLOW.md** - Data flow changes
- **API docs** (if applicable) - API endpoint documentation

---

## 🎯 Areas Needing Contribution

We especially welcome contributions in these areas:

### High Priority
- [ ] Mobile responsiveness improvements
- [ ] Accessibility (ARIA labels, keyboard navigation)
- [ ] Performance optimization
- [ ] Test coverage improvements
- [ ] Error handling and user feedback

### Features
- [ ] Comments and engagement features
- [ ] User profile pages
- [ ] Subscription system
- [ ] Live streaming support
- [ ] Content moderation tools
- [ ] Creator analytics

### Documentation
- [ ] API documentation
- [ ] Architecture diagrams
- [ ] Deployment guides
- [ ] Troubleshooting guides

---

## 💬 Getting Help

If you need help:

1. **Check the documentation** - README.md, ARCHITECTURE.md
2. **Search existing issues** - Your question might already be answered
3. **Ask in Discussions** - [GitHub Discussions](https://github.com/Legendarytunzeverywhere/shelbyflix/discussions)
4. **Open an issue** - For specific bugs or feature requests

---

## 📜 License

By contributing to ShelbyFlix, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

## 🙏 Thank You!

Your contributions help make ShelbyFlix better for everyone. We appreciate your time and effort! 🚀

---

<div align="center">
  <strong>Happy coding! 💻</strong>
</div>
