const Octokit = require('@octokit/rest')
const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
})

const REPOSITORY_SETTINGS = { owner: 'zeit', repo: 'next.js' }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const all = await octokit.pulls.list({
    ...REPOSITORY_SETTINGS,
    base: 'canary',
    state: 'open',
  })

  let readyForMerge = (await Promise.all(
    all.data
      .filter(k => k.labels.find(k => k.id === 1468772558))
      .map(k => k.number)
      .map(number =>
        octokit.pulls.get({
          ...REPOSITORY_SETTINGS,
          pull_number: number,
        })
      )
  ))
    .map(pr => pr.data)
    .filter(pr => pr.maintainer_can_modify)

  if (!readyForMerge.length) {
    return false
  }

  async function mergeSinglePullRequest() {
    const mergeable = readyForMerge.find(
      pr =>
        pr.mergeable &&
        (pr.mergeable_state === 'clean' || pr.mergeable_state === 'unstable')
    )
    if (mergeable) {
      console.log(`Merging PR ${mergeable.number}`)
      await octokit.pulls.merge({
        ...REPOSITORY_SETTINGS,
        pull_number: mergeable.number,
        merge_method: 'squash',
      })

      readyForMerge = readyForMerge.filter(pr => pr.number !== mergeable.number)

      await sleep(5000)
      return true
    } else {
      readyForMerge.forEach(pr => {
        console.log(
          `PR ${pr.number} (${pr.title}) state / mergeable: ${
            pr.mergeable
          } :: mergeable_state: ${pr.mergeable_state}`
        )
      })
    }
  }

  async function updatePullRequests() {
    readyForMerge = await Promise.all(
      readyForMerge.map(pr =>
        octokit.pulls
          .get({
            ...REPOSITORY_SETTINGS,
            pull_number: pr.number,
          })
          .then(pr => pr.data)
      )
    )
  }

  while (readyForMerge.length) {
    console.log(
      `remaining prs: ${readyForMerge
        .map(pr => pr.number)
        .join(', ')} at ${new Date()}`
    )

    await Promise.all(
      readyForMerge
        .filter(pr => pr.mergeable_state === 'behind')
        .map(pr => {
          console.log(`Updating branch for PR: ${pr.number}`)
          return octokit.pulls.updateBranch({
            ...REPOSITORY_SETTINGS,
            pull_number: pr.number,
          })
        })
    )

    const didAMerge = await mergeSinglePullRequest()
    if (didAMerge) {
      return true
    }

    await sleep(1000 * 60) // one minute
    await updatePullRequests()
    console.log()
  }

  return true
}

async function loopMain() {
  for (;;) {
    const res = await main()
    if (!res) {
      break
    }
  }
}

loopMain()
