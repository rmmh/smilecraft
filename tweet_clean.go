package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

func main() {
	names, _ := ioutil.ReadFile("data/emoji_names.json")
	emm := map[string][]string{}
	json.Unmarshal(names, &emm)
	ems := []string{}
	for em := range emm {
		if em[0] == '*' {
			em = "\\" + em
		}
		ems = append(ems, em)
	}
	sort.Slice(ems, func(i, j int) bool {
		return len(ems[i]) > len(ems[j]) || ems[i] < ems[j]
	})

	seenTwids := map[string]bool{}

	res := fmt.Sprintf("((?:%s)\\x{fe0f}?)", strings.Join(ems, "|"))
	re := regexp.MustCompile(res)
	urlRe := regexp.MustCompile(`(https?://[^/]*)\S*`)
	badCharRe := regexp.MustCompile(`[()"'!,.]`)

	reader := bufio.NewReader(os.Stdin)

	lineChan := make(chan string, 8)
	outChan := make(chan string, 8)

	wg := sync.WaitGroup{}

	for i := 0; i < runtime.NumCPU(); i++ {
		go func() {
			for text := range lineChan {
				text = strings.ToLower(text)
				text = urlRe.ReplaceAllString(text, "$1")
				text = badCharRe.ReplaceAllLiteralString(text, "")
				outChan <- re.ReplaceAllString(text, " $1 ")
			}
		}()
	}

	go func() {
		for text := range outChan {
			fmt.Print(text)
			wg.Done()
		}
	}()

	for {
		text, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		// Bots tweet these memes with random emoji substituted in-- drop the noise.
		if strings.Index(text, "howdy. i'm the sheriff of") >= 0 ||
			strings.Index(text, "Beep boop, I am a robot made out") >= 0 {
			continue
		}
		p := strings.SplitN(text, " ", 4)
		if len(p) != 4 {
			continue
		}
		if seenTwids[p[0]] {
			continue
		}
		seenTwids[p[0]] = true
		wg.Add(1)
		lineChan <- p[3]
	}

	wg.Wait()
}
