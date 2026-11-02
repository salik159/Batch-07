// TEST DOUBLE ONLY. Mimics an AI backend (Gemini / Ollama / test double)
// so the Coding Agent and Email Agent pipelines can be tested offline.
// It returns different, valid programs for different instructions so tests
// can assert the pipeline is instruction-driven and provider-independent.
import http from "node:http";

const J = (name, body) => "```java\n" + `public class ${name} {\n${body}\n}\n` + "```";
const PROGRAMS = [
  [/prime/i, "PrimeChecker", `    static boolean isPrime(int n){ if(n<2) return false; for(int i=2;(long)i*i<=n;i++) if(n%i==0) return false; return true; }\n    public static void main(String[] a){ for(int n: new int[]{2,15,29,97,100}) System.out.println(n+" is "+(isPrime(n)?"prime":"not prime")); }`],
  [/binary\s*search/i, "BinarySearchDemo", `    static int search(int[] arr,int t){ int lo=0,hi=arr.length-1; while(lo<=hi){ int mid=(lo+hi)>>>1; if(arr[mid]==t) return mid; if(arr[mid]<t) lo=mid+1; else hi=mid-1; } return -1; }\n    public static void main(String[] a){ int[] arr={1,3,5,7,9,11}; System.out.println("Index of 7: "+search(arr,7)); System.out.println("Index of 4: "+search(arr,4)); }`],
  [/multilevel\s*inheritance/i, "MultilevelInheritance", `    static class Animal{ void eat(){ System.out.println("Animal eats"); } }\n    static class Dog extends Animal{ void bark(){ System.out.println("Dog barks"); } }\n    static class Puppy extends Dog{ void weep(){ System.out.println("Puppy weeps"); } }\n    public static void main(String[] a){ Puppy p=new Puppy(); p.eat(); p.bark(); p.weep(); }`],
  [/factorial/i, "FactorialDemo", `    static long fact(int n){ return n<=1?1:n*fact(n-1); }\n    public static void main(String[] a){ System.out.println("5! = "+fact(5)); System.out.println("10! = "+fact(10)); }`],
  [/two\s*sum/i, "TwoSum", `    static int[] twoSum(int[] nums,int target){ java.util.Map<Integer,Integer> seen=new java.util.HashMap<>(); for(int i=0;i<nums.length;i++){ Integer j=seen.get(target-nums[i]); if(j!=null) return new int[]{j,i}; seen.put(nums[i],i);} return new int[0]; }\n    public static void main(String[] a){ System.out.println(java.util.Arrays.toString(twoSum(new int[]{2,7,11,15},9))); }`],
  [/linked\s*list/i, "SimpleLinkedList", `    static class Node{ int v; Node next; Node(int v){this.v=v;} }\n    Node head;\n    void add(int v){ Node n=new Node(v); if(head==null){head=n;return;} Node c=head; while(c.next!=null)c=c.next; c.next=n; }\n    public static void main(String[] a){ SimpleLinkedList l=new SimpleLinkedList(); l.add(1); l.add(2); l.add(3); for(Node c=l.head;c!=null;c=c.next) System.out.print(c.v+" "); System.out.println(); }`],
  [/calculator/i, "SwitchCalculator", `    static double calc(double x,double y,char op){ switch(op){ case '+': return x+y; case '-': return x-y; case '*': return x*y; case '/': return x/y; default: throw new IllegalArgumentException("bad op"); } }\n    public static void main(String[] a){ System.out.println(calc(8,2,'+')+" "+calc(8,2,'/')); }`],
  [/jdbc|mysql/i, "MySqlJdbcDemo", `    public static void main(String[] a) throws Exception {\n        String url=System.getenv().getOrDefault("DB_URL","jdbc:mysql://localhost:3306/test");\n        try(java.sql.Connection c=java.sql.DriverManager.getConnection(url,System.getenv("DB_USER"),System.getenv("DB_PASSWORD"))){ System.out.println("Connected: "+c.getMetaData().getURL()); }\n    }`],
  [/reverse/i, "ReverseNumber", `    public static void main(String[] a){ int n=12345,r=0; while(n>0){ r=r*10+n%10; n/=10; } System.out.println(r); }`],
];

export function startMock(port = 0) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    
    // Support Ollama /api/chat format: { messages: [{role, content}], ... }
    // As well as Gemini/Ollama mock formats
    let user = "";
    let system = "";
    if (Array.isArray(body.messages)) {
      system = body.messages.find(m => m.role === "system")?.content || "";
      user = body.messages.filter(m => m.role === "user").map(m => m.content).join("\n");
    } else if (Array.isArray(body.input)) {
      system = body.input[0]?.content || "";
      user = body.input.filter(m => m.role === "user").map(m => m.content).join("\n");
    } else {
      user = String(body.contents || body.prompt || "");
    }

    calls.push({ user, system });
    let text;
    const request = (user.match(/User request: (.*)/) || [, user])[1];
    if (/Allowed actions/.test(system || "") && /unknown-action-test/i.test(user)) {
      text = JSON.stringify({ agent: "general", intent: "computer_task", summary: "x", actions: [{ type: "coding_ai_generate", prompt: user }] });
    } else if (/failed to compile/i.test(user) && /stubborn/i.test(user)) {
      text = "```java\npublic class Stubborn {\n    public static void main(String[] a){ int x = \"s\"; }\n}\n```";
    } else if (/failed to compile/i.test(user)) {
      const name = (user.match(/public class (\w+)/) || [, "Fixed"])[1];
      text = J(name, `    public static void main(String[] a){ System.out.println("fixed"); }`) + "\nEXPLANATION: Fixed version.";
    } else if (/syntax error test/i.test(request)) {
      text = "```java\npublic class Broken {\n    public static void main(String[] a){ System.out.println(\"x\") }\n}\n```\nEXPLANATION: Broken first.";
    } else if (/stubborn/i.test(request)) {
      text = "```java\npublic class Stubborn {\n    public static void main(String[] a){ int x = \"s\"; }\n}\n```";
    } else if (/summar|brief/i.test(system || "") && /EMAILS/.test(user)) {
      text = "MOCK-LLM-BRIEF: summary of the supplied emails.";
    } else {
      const hit = PROGRAMS.find(([re]) => re.test(request));
      if (!hit) {
        text = "I could not tell what to build.";
      } else {
        const only = /only the code|code only/i.test(request);
        text = hit[2] ? J(hit[1], hit[2]) + (only ? "" : `\nEXPLANATION: This program is ${hit[1]}, generated for: ${request.slice(0, 60)}.`) : "";
      }
    }

    // Return in Ollama format if /api/chat
    if (req.url.includes("/api/chat")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: { role: "assistant", content: text } }));
    }
    // Generic format
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text, output_text: text }));
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r({ server, port: server.address().port, calls })));
}
