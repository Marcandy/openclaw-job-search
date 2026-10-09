"""Build two resume variants:
  1. Marc-Andy_Resume_Python_React.pdf - Python / React / TypeScript focus
  2. Marc-Andy_Resume_Java_React.pdf  - Java / React / TypeScript focus

Both summaries mention mentoring junior developers.
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, HRFlowable

name = ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=15, alignment=TA_CENTER, spaceAfter=2)
contact = ParagraphStyle("contact", fontName="Helvetica", fontSize=8, alignment=TA_CENTER, textColor="#333333", spaceAfter=4)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=9.5, spaceBefore=6, spaceAfter=1.5, textColor="#111111")
role = ParagraphStyle("role", fontName="Helvetica-Bold", fontSize=9, spaceBefore=4, spaceAfter=0)
dates = ParagraphStyle("dates", fontName="Helvetica-Oblique", fontSize=8, textColor="#444444", spaceAfter=1)
body = ParagraphStyle("body", fontName="Helvetica", fontSize=8.6, leading=10.5)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=3, spaceAfter=0.5)
skill = ParagraphStyle("skill", parent=body, spaceAfter=1)
tools = ParagraphStyle("tools", fontName="Helvetica-Oblique", fontSize=8, leading=10, textColor="#444444", leftIndent=12, spaceAfter=1)

def B(t): return Paragraph(t, bullet, bulletText="\u2022")
def T(t): return Paragraph("<b>Tools & technologies:</b> " + t, tools)
def P(t, s=body): return Paragraph(t, s)

HEADER = [
    P("Marc-Andy Noel Jeune", name),
    P("484-463-7138 | marcandy.nj@gmail.com | linkedin.com/in/marcandy | github.com/marcandy | marcandy.github.io", contact),
    HRFlowable(width="100%", thickness=0.7, color="#888888"),
]

# ---------------------------------------------------------------- variant 1
python_react = HEADER + [
    P("SUMMARY", h2),
    P("Full-stack software engineer with 10 years shipping production systems, focused on Python backends and "
      "React/TypeScript front ends, from regulated financial systems at Wells Fargo to a high-traffic retail "
      "platform at JCPenney and client engagements where I own architecture and delivery hands-on. I build "
      "AI-driven automation with LLM agent pipelines in daily practice, and I mentor junior developers through "
      "pairing, code review, and shared engineering standards."),

    P("LANGUAGES | FRAMEWORKS | TOOLS", h2),
    P("<b>Python</b>, <b>TypeScript</b>, JavaScript, Java | <b>Django</b>, <b>React</b>, Node.js, Spring Boot | "
      "REST APIs, PostgreSQL | AWS, Docker, CloudFormation, GitHub Actions, CI/CD, pytest, Jest, Playwright", skill),

    P("EXPERIENCE", h2),
    P("Software Consultant / Technical Lead \u2014 Lotnivo, Remote", role),
    P("March 2022 - Present", dates),
    B("Architect and build full-stack features across 5+ client engagements: Python/Django backends with "
      "PostgreSQL, migrations, and authentication, paired with React and TypeScript front ends and Node.js services."),
    B("Build AI-driven automation in Python, including a multi-stage LLM agent pipeline with rule-based model "
      "routing and human-approval gates that processes hundreds of job applications per week and cuts manual "
      "screening time by roughly 70% in a live production recruiting workflow."),
    B("Modernize tightly coupled systems into modular, independently deployable services with clear API "
      "boundaries, versioned contracts, and event-driven processing, cutting deploy time from hours to "
      "minutes and reducing production incidents by an estimated 40%."),
    B("Standardize how teams build: reusable React component libraries and shared Python and TypeScript "
      "packages, coding standards, review practices, and a testing strategy (pytest, Jest, Playwright) "
      "reaching 80%+ coverage across contributors."),
    B("Apply DevSecOps practices on AWS (Lambda, S3, EC2): infrastructure as code with CloudFormation, Docker "
      "containers, and GitHub Actions CI/CD with automated test gates and security built in from the start."),
    B("Mentor junior developers through pairing and code review, and partner with stakeholders and business "
      "owners on feasibility, scope, and delivery plans in Agile iterations."),
    T("Jira, Confluence, GitHub, Docker, AWS, CloudFormation, GitHub Actions, PostgreSQL, pytest/JUnit, Jest, Playwright"),

    P("Software Engineer \u2014 Wells Fargo, Charlotte, NC", role),
    P("May 2019 - June 2020", dates),
    B("Built and maintained backend REST services in Java with Spring Boot, implementing controller, service, "
      "and repository layers over relational data for internal financial applications."),
    B("Built a Node.js and Express middleware layer between React front ends and Spring Boot services, handling "
      "session propagation, request validation, and error normalization across a large multi-team codebase."),
    B("Partnered with security and compliance teams on secure coding and access patterns in a regulated "
      "environment, and implemented WCAG/ARIA accessibility and internationalization that expanded the usable "
      "audience by over 25%."),
    T("Jira, Confluence, Git, Java, Spring Boot, Node.js, Express, React"),

    P("Software Engineer \u2014 JCPenney, Plano, TX", role),
    P("June 2017 - May 2019", dates),
    B("Refactored a legacy monolith into modular, component-driven React architecture with Redux state "
      "management, improving scalability, performance, and long-term maintainability of a platform already in production."),
    B("Built front-end features and integrated backend services for a high-traffic retail loyalty platform "
      "serving millions of users at e-commerce scale."),
    B("Optimized performance and load times under heavy traffic, owning code quality through code reviews and "
      "production troubleshooting."),
    T("Jira, Git, React, Redux, Node.js"),

    P("OPEN SOURCE & HACKATHONS", h2),
    P("PA Expunger (PAX) \u2014 Code for Philly and Philadelphia Lawyers for Social Equity", role),
    B("Open source web app that generates Pennsylvania criminal record expungement petitions by parsing county "
      "docket sheets, replacing manual petition drafting for the attorneys and volunteers who file them."),
    B("Contributed to deploying the Python/Django application so PLSE attorneys can use the live demo."),
    B("Worked in a containerized Django and React codebase with Docker Compose, pytest, and an image-based "
      "deployment pipeline to a Kubernetes cluster."),
    B("Full Project Tech Stack: Python, Django, React, PostgreSQL, Docker Compose, pytest, GitHub Actions, Kubernetes"),

    P("Think-Wide \u2014 AI Agent Hackathon, September 2026", role),
    B("MCP tools and a web workbench giving coding agents verifiable cross-repo evidence, built on a "
      "contract-first architecture in TypeScript; 19 pull requests merged in one day behind 591 passing tests."),
    B("Designed the evidence-contract format and Model Context Protocol (MCP) servers so any MCP-compatible "
      "coding agent can query verified project context before acting, reducing hallucinated code references "
      "in multi-repo automation."),
    T("TypeScript, Model Context Protocol (MCP), GitHub Actions"),
]

# ---------------------------------------------------------------- variant 2
java_react = HEADER + [
    P("SUMMARY", h2),
    P("Full-stack software engineer with 10 years shipping production systems, focused on Java/Spring Boot "
      "backends and React/TypeScript front ends, from regulated financial systems at Wells Fargo to a "
      "high-traffic retail platform at JCPenney and client engagements where I own architecture and delivery "
      "hands-on. I build AI-driven automation with LLM agent pipelines in daily practice, and I mentor junior "
      "developers through pairing, code review, and shared engineering standards."),

    P("LANGUAGES | FRAMEWORKS | TOOLS", h2),
    P("<b>Java</b>, <b>TypeScript</b>, JavaScript, Python | <b>Spring Boot</b>, <b>React</b>, Node.js, Django | "
      "REST APIs, PostgreSQL | AWS, Docker, CloudFormation, GitHub Actions, CI/CD, JUnit, Jest, Playwright", skill),

    P("EXPERIENCE", h2),
    P("Software Consultant / Technical Lead \u2014 Lotnivo, Remote", role),
    P("March 2022 - Present", dates),
    B("Architect and build full-stack features across 5+ client engagements: JVM and Node.js backend services "
      "with PostgreSQL, paired with React and TypeScript front ends and shared component libraries."),
    B("Build AI-driven automation, including a multi-stage LLM agent pipeline with rule-based model routing and "
      "human-approval gates that processes hundreds of job applications per week and cuts manual screening time "
      "by roughly 70% in a live production recruiting workflow."),
    B("Modernize tightly coupled systems into modular, independently deployable services with clear API "
      "boundaries, versioned contracts, and event-driven processing, cutting deploy time from hours to "
      "minutes and reducing production incidents by an estimated 40%."),
    B("Standardize how teams build: reusable React component libraries and shared TypeScript packages, coding "
      "standards, review practices, and a testing strategy (JUnit, Jest, Playwright) reaching 80%+ coverage "
      "across contributors."),
    B("Apply DevSecOps practices on AWS (Lambda, S3, EC2): infrastructure as code with CloudFormation, Docker "
      "containers, and GitHub Actions CI/CD with automated test gates and security built in from the start."),
    B("Mentor junior developers through pairing and code review, and partner with stakeholders and business "
      "owners on feasibility, scope, and delivery plans in Agile iterations."),
    T("Jira, Confluence, GitHub, Docker, AWS, CloudFormation, GitHub Actions, PostgreSQL, pytest/JUnit, Jest, Playwright"),

    P("Software Engineer \u2014 Wells Fargo, Charlotte, NC", role),
    P("May 2019 - June 2020", dates),
    B("Built and maintained backend REST services in Java with Spring Boot, implementing controller, service, "
      "and repository layers over relational data for internal financial applications."),
    B("Built a Node.js and Express middleware layer between React front ends and Spring Boot services, handling "
      "session propagation, request validation, and error normalization across a large multi-team codebase."),
    B("Partnered with security and compliance teams on secure coding and access patterns in a regulated "
      "environment, and implemented WCAG/ARIA accessibility and internationalization that expanded the usable "
      "audience by over 25%."),
    T("Jira, Confluence, Git, Java, Spring Boot, Node.js, Express, React"),

    P("Software Engineer \u2014 JCPenney, Plano, TX", role),
    P("June 2017 - May 2019", dates),
    B("Refactored a legacy monolith into modular, component-driven React architecture with Redux state "
      "management, improving scalability, performance, and long-term maintainability of a platform already in production."),
    B("Built front-end features and integrated backend Java services for a high-traffic retail loyalty platform "
      "serving millions of users at e-commerce scale."),
    B("Optimized performance and load times under heavy traffic, owning code quality through code reviews and "
      "production troubleshooting."),
    T("Jira, Git, React, Redux, Node.js"),

    P("OPEN SOURCE & HACKATHONS", h2),
    P("PA Expunger (PAX) \u2014 Code for Philly and Philadelphia Lawyers for Social Equity", role),
    B("Open source web app that generates Pennsylvania criminal record expungement petitions by parsing county "
      "docket sheets, replacing manual petition drafting for the attorneys and volunteers who file them."),
    B("Contributed to deploying the Django application so PLSE attorneys can use the live demo."),
    B("Worked in a containerized Django and React codebase with Docker Compose, pytest, and an image-based "
      "deployment pipeline to a Kubernetes cluster."),
    B("Full Project Tech Stack: Python, Django, React, PostgreSQL, Docker Compose, pytest, GitHub Actions, Kubernetes"),

    P("Think-Wide \u2014 AI Agent Hackathon, September 2026", role),
    B("MCP tools and a web workbench giving coding agents verifiable cross-repo evidence, built on a "
      "contract-first architecture in TypeScript; 19 pull requests merged in one day behind 591 passing tests."),
    B("Designed the evidence-contract format and Model Context Protocol (MCP) servers so any MCP-compatible "
      "coding agent can query verified project context before acting, reducing hallucinated code references "
      "in multi-repo automation."),
    T("TypeScript, Model Context Protocol (MCP), GitHub Actions"),
]

for out, story, title in [
    ("Marc-Andy_Resume_Python_React.pdf", python_react, "Marc-Andy Noel Jeune - Python React TypeScript Engineer"),
    ("Marc-Andy_Resume_Java_React.pdf", java_react, "Marc-Andy Noel Jeune - Java React TypeScript Engineer"),
]:
    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch,
                            topMargin=0.45*inch, bottomMargin=0.45*inch, title=title)
    doc.build(story)
    print("built", out)
