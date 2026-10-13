(() => {
  const content = document.querySelector('.blog-post-content rte-formatter, .blog-post-content');
  const tocNav = document.querySelector('[data-article-toc]');
  const tocList = document.querySelector('[data-article-toc-list]');
  const tocWrap = document.querySelector('[data-article-toc-wrap]');
  if (!content || !tocList || !tocWrap) return;

  const headings = content.querySelectorAll('h2, h3');
  if (!headings.length) {
    tocWrap.hidden = true;
    return;
  }

  const slugify = (text, index) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return base ? `${base}-${index}` : `section-${index}`;
  };

  const fragment = document.createDocumentFragment();
  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = slugify(heading.textContent || '', index);
    const level = heading.tagName.toLowerCase();
    const li = document.createElement('li');
    li.className = `article-toc__item article-toc__item--${level}`;
    const a = document.createElement('a');
    a.className = 'article-toc__link';
    a.href = `#${heading.id}`;
    a.textContent = heading.textContent.trim();
    li.appendChild(a);
    fragment.appendChild(li);
  });
  tocList.appendChild(fragment);
  tocWrap.hidden = false;

  const links = tocList.querySelectorAll('.article-toc__link');
  const onScroll = () => {
    let currentId = '';
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= 120) currentId = heading.id;
    });
    links.forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === `#${currentId}`);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (tocNav) {
    tocNav.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', link.getAttribute('href'));
    });
  }
})();
